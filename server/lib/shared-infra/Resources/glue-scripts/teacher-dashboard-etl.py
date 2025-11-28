"""
Glue ETL Job: Teacher Dashboard Materialized View

Aggregates teacher and classroom-specific metrics:
- assessment_events: Average scores by classroom
- attendance_events: Average attendance by classroom
- enrollment_events: Student count by classroom

Output: Parquet format materialized view partitioned by year/month/day
Location: s3://{bucket}/materialized-views/teacher-dashboards/
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from pyspark.sql import functions as F
from pyspark.sql.types import *
import json

# Get job parameters
args = getResolvedOptions(sys.argv, [
    'JOB_NAME',
    'database',
    'output-bucket',
    'output-prefix'
])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

database_name = args['database']
output_bucket = args['output-bucket']
output_prefix = args['output-prefix']
output_path = f"s3://{output_bucket}/{output_prefix}/"

print(f"Starting ETL job: {args['JOB_NAME']}")
print(f"Database: {database_name}")
print(f"Output path: {output_path}")

# Read assessment events
print("Reading assessment_events...")
assessment_df = glueContext.create_dynamic_frame.from_catalog(
    database=database_name,
    table_name="assessment_events",
    transformation_ctx="assessment_events"
).toDF()

# Read attendance events
print("Reading attendance_events...")
attendance_df = glueContext.create_dynamic_frame.from_catalog(
    database=database_name,
    table_name="attendance_events",
    transformation_ctx="attendance_events"
).toDF()

# Read enrollment events (for student count by classroom)
print("Reading enrollment_events...")
enrollment_df = glueContext.create_dynamic_frame.from_catalog(
    database=database_name,
    table_name="enrollment_events",
    transformation_ctx="enrollment_events"
).toDF()

# Process assessment events - calculate average score by teacher and classroom
print("Processing assessment events...")
assessment_processed = assessment_df.filter(
    F.col('"detail-type"') == 'GradePublished'
).select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'teacherId', 'classroomId', 'studentId', 'score', 'maxScore').alias('tenantId', 'schoolId', 'academicYearId', 'teacherId', 'classroomId', 'studentId', 'score', 'maxScore')
).withColumn('score', F.col('score').cast('double')) \
 .withColumn('maxScore', F.col('maxScore').cast('double')) \
 .withColumn('percentage', (F.col('score') / F.col('maxScore')) * 100) \
 .groupBy('tenantId', 'schoolId', 'academicYearId', 'teacherId', 'classroomId') \
 .agg(F.avg('percentage').alias('avgScore'))

# Process attendance events - calculate average attendance by classroom
print("Processing attendance events...")
attendance_processed = attendance_df.select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'classroomId', 'studentId', 'date', 'status').alias('tenantId', 'schoolId', 'academicYearId', 'classroomId', 'studentId', 'date', 'status')
).groupBy('tenantId', 'schoolId', 'academicYearId', 'classroomId', 'studentId') \
 .agg(
     F.count('date').alias('totalDays'),
     F.sum(F.when(F.col('status') == 'PRESENT', 1).otherwise(0)).alias('presentDays')
 ).withColumn('attendanceRate', (F.col('presentDays') / F.col('totalDays')) * 100) \
 .groupBy('tenantId', 'schoolId', 'academicYearId', 'classroomId') \
 .agg(F.avg('attendanceRate').alias('avgAttendanceRate'))

# Process enrollment events - count students by classroom
print("Processing enrollment events...")
enrollment_processed = enrollment_df.filter(
    F.col('"detail-type"') == 'StudentEnrolledInClassroom'
).select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'classroomId', 'studentId', 'teacherId').alias('tenantId', 'schoolId', 'academicYearId', 'classroomId', 'studentId', 'teacherId')
).groupBy('tenantId', 'schoolId', 'academicYearId', 'teacherId', 'classroomId') \
 .agg(F.countDistinct('studentId').alias('studentCount'))

# Join all aggregations
print("Joining all aggregations...")
teacher_dashboard = enrollment_processed.join(
    assessment_processed,
    on=['tenantId', 'schoolId', 'academicYearId', 'teacherId', 'classroomId'],
    how='full_outer'
).join(
    attendance_processed,
    on=['tenantId', 'schoolId', 'academicYearId', 'classroomId'],
    how='full_outer'
).select(
    F.coalesce(enrollment_processed['tenantId'], assessment_processed['tenantId'], attendance_processed['tenantId']).alias('tenantId'),
    F.coalesce(enrollment_processed['schoolId'], assessment_processed['schoolId'], attendance_processed['schoolId']).alias('schoolId'),
    F.coalesce(enrollment_processed['academicYearId'], assessment_processed['academicYearId'], attendance_processed['academicYearId']).alias('academicYearId'),
    F.coalesce(enrollment_processed['teacherId'], assessment_processed['teacherId']).alias('teacherId'),
    F.coalesce(enrollment_processed['classroomId'], assessment_processed['classroomId'], attendance_processed['classroomId']).alias('classroomId'),
    F.coalesce(enrollment_processed['studentCount'], F.lit(0)).alias('studentCount'),
    F.coalesce(assessment_processed['avgScore'], F.lit(0.0)).alias('avgScore'),
    F.coalesce(attendance_processed['avgAttendanceRate'], F.lit(0.0)).alias('avgAttendanceRate')
).withColumn('lastUpdated', F.current_timestamp().cast('string'))

# Add partition columns
print("Adding partition columns...")
teacher_dashboard = teacher_dashboard.withColumn('year', F.date_format(F.current_date(), 'yyyy')) \
                                     .withColumn('month', F.date_format(F.current_date(), 'MM')) \
                                     .withColumn('day', F.date_format(F.current_date(), 'dd'))

# Convert back to DynamicFrame
print("Converting to DynamicFrame...")
teacher_dashboard_dynamic = DynamicFrame.fromDF(teacher_dashboard, glueContext, "teacher_dashboard")

# Write to S3 in Parquet format with partitioning
print(f"Writing to {output_path}...")
glueContext.write_dynamic_frame.from_options(
    frame=teacher_dashboard_dynamic,
    connection_type="s3",
    connection_options={
        "path": output_path,
        "partitionKeys": ["year", "month", "day"]
    },
    format="parquet",
    format_options={"compression": "snappy"}
)

print("ETL job completed successfully!")
job.commit()

