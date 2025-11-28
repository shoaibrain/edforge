"""
Glue ETL Job: Student Dashboard Materialized View

Aggregates student performance data from multiple event tables:
- assessment_events: Grades and assignments
- attendance_events: Attendance records
- enrollment_events: Enrollment status

Output: Parquet format materialized view partitioned by year/month/day
Location: s3://{bucket}/materialized-views/student-dashboards/
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

# Read assessment events (grades)
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

# Read enrollment events
print("Reading enrollment_events...")
enrollment_df = glueContext.create_dynamic_frame.from_catalog(
    database=database_name,
    table_name="enrollment_events",
    transformation_ctx="enrollment_events"
).toDF()

# Process assessment events to calculate GPA and completion rate
print("Processing assessment events...")
assessment_processed = assessment_df.filter(
    F.col('"detail-type"') == 'GradePublished'
).select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'studentId', 'score', 'maxScore', 'assignmentId').alias('tenantId', 'schoolId', 'academicYearId', 'studentId', 'score', 'maxScore', 'assignmentId')
).withColumn('score', F.col('score').cast('double')) \
 .withColumn('maxScore', F.col('maxScore').cast('double')) \
 .withColumn('percentage', (F.col('score') / F.col('maxScore')) * 100) \
 .groupBy('tenantId', 'schoolId', 'academicYearId', 'studentId') \
 .agg(
     F.avg('percentage').alias('avgScore'),
     F.count('assignmentId').alias('completedAssignments'),
     F.countDistinct('assignmentId').alias('totalAssignments')
 ).withColumn('completionRate', (F.col('completedAssignments') / F.col('totalAssignments')) * 100) \
 .withColumn('gpa', 
     F.when(F.col('avgScore') >= 90, 4.0)
     .when(F.col('avgScore') >= 80, 3.0)
     .when(F.col('avgScore') >= 70, 2.0)
     .when(F.col('avgScore') >= 60, 1.0)
     .otherwise(0.0)
 )

# Process attendance events to calculate attendance rate
print("Processing attendance events...")
attendance_processed = attendance_df.select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'studentId', 'date', 'status').alias('tenantId', 'schoolId', 'academicYearId', 'studentId', 'date', 'status')
).groupBy('tenantId', 'schoolId', 'academicYearId', 'studentId') \
 .agg(
     F.count('date').alias('totalDays'),
     F.sum(F.when(F.col('status') == 'PRESENT', 1).otherwise(0)).alias('presentDays')
 ).withColumn('attendanceRate', (F.col('presentDays') / F.col('totalDays')) * 100)

# Join assessment and attendance data
print("Joining assessment and attendance data...")
student_dashboard = assessment_processed.join(
    attendance_processed,
    on=['tenantId', 'schoolId', 'academicYearId', 'studentId'],
    how='full_outer'
).select(
    F.coalesce(assessment_processed['tenantId'], attendance_processed['tenantId']).alias('tenantId'),
    F.coalesce(assessment_processed['schoolId'], attendance_processed['schoolId']).alias('schoolId'),
    F.coalesce(assessment_processed['academicYearId'], attendance_processed['academicYearId']).alias('academicYearId'),
    F.coalesce(assessment_processed['studentId'], attendance_processed['studentId']).alias('studentId'),
    F.coalesce(assessment_processed['gpa'], F.lit(0.0)).alias('gpa'),
    F.coalesce(attendance_processed['attendanceRate'], F.lit(0.0)).alias('attendanceRate'),
    F.coalesce(assessment_processed['completionRate'], F.lit(0.0)).alias('completionRate')
).withColumn('lastUpdated', F.current_timestamp().cast('string'))

# Add partition columns (year/month/day from current date)
print("Adding partition columns...")
student_dashboard = student_dashboard.withColumn('year', F.date_format(F.current_date(), 'yyyy')) \
                                     .withColumn('month', F.date_format(F.current_date(), 'MM')) \
                                     .withColumn('day', F.date_format(F.current_date(), 'dd'))

# Convert back to DynamicFrame
print("Converting to DynamicFrame...")
student_dashboard_dynamic = DynamicFrame.fromDF(student_dashboard, glueContext, "student_dashboard")

# Write to S3 in Parquet format with partitioning
print(f"Writing to {output_path}...")
glueContext.write_dynamic_frame.from_options(
    frame=student_dashboard_dynamic,
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

