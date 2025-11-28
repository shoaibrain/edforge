"""
Glue ETL Job: Principal Dashboard Materialized View

Aggregates school-wide metrics from all event tables:
- enrollment_events: Total students, enrollment by grade
- attendance_events: Average attendance rate
- assessment_events: Average GPA, at-risk student count

Output: Parquet format materialized view partitioned by year/month/day
Location: s3://{bucket}/materialized-views/principal-dashboards/
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

# Read enrollment events
print("Reading enrollment_events...")
enrollment_df = glueContext.create_dynamic_frame.from_catalog(
    database=database_name,
    table_name="enrollment_events",
    transformation_ctx="enrollment_events"
).toDF()

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

# Process enrollment events - count total students
print("Processing enrollment events...")
enrollment_processed = enrollment_df.filter(
    F.col('"detail-type"') == 'StudentEnrolled'
).select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'studentId').alias('tenantId', 'schoolId', 'academicYearId', 'studentId')
).groupBy('tenantId', 'schoolId', 'academicYearId') \
 .agg(F.countDistinct('studentId').alias('totalStudents'))

# Process assessment events - calculate average GPA and at-risk count
print("Processing assessment events...")
assessment_processed = assessment_df.filter(
    F.col('"detail-type"') == 'GradePublished'
).select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'studentId', 'score', 'maxScore').alias('tenantId', 'schoolId', 'academicYearId', 'studentId', 'score', 'maxScore')
).withColumn('score', F.col('score').cast('double')) \
 .withColumn('maxScore', F.col('maxScore').cast('double')) \
 .withColumn('percentage', (F.col('score') / F.col('maxScore')) * 100) \
 .groupBy('tenantId', 'schoolId', 'academicYearId', 'studentId') \
 .agg(F.avg('percentage').alias('avgScore')) \
 .withColumn('gpa',
     F.when(F.col('avgScore') >= 90, 4.0)
     .when(F.col('avgScore') >= 80, 3.0)
     .when(F.col('avgScore') >= 70, 2.0)
     .when(F.col('avgScore') >= 60, 1.0)
     .otherwise(0.0)
 ).groupBy('tenantId', 'schoolId', 'academicYearId') \
 .agg(
     F.avg('gpa').alias('avgGPA'),
     F.sum(F.when(F.col('gpa') < 2.0, 1).otherwise(0)).alias('atRiskCount')
 )

# Process attendance events - calculate average attendance rate
print("Processing attendance events...")
attendance_processed = attendance_df.select(
    F.json_tuple(F.col('detail'), 'tenantId', 'schoolId', 'academicYearId', 'studentId', 'date', 'status').alias('tenantId', 'schoolId', 'academicYearId', 'studentId', 'date', 'status')
).groupBy('tenantId', 'schoolId', 'academicYearId', 'studentId') \
 .agg(
     F.count('date').alias('totalDays'),
     F.sum(F.when(F.col('status') == 'PRESENT', 1).otherwise(0)).alias('presentDays')
 ).withColumn('attendanceRate', (F.col('presentDays') / F.col('totalDays')) * 100) \
 .groupBy('tenantId', 'schoolId', 'academicYearId') \
 .agg(F.avg('attendanceRate').alias('avgAttendanceRate'))

# Join all aggregations
print("Joining all aggregations...")
principal_dashboard = enrollment_processed.join(
    assessment_processed,
    on=['tenantId', 'schoolId', 'academicYearId'],
    how='full_outer'
).join(
    attendance_processed,
    on=['tenantId', 'schoolId', 'academicYearId'],
    how='full_outer'
).select(
    F.coalesce(enrollment_processed['tenantId'], assessment_processed['tenantId'], attendance_processed['tenantId']).alias('tenantId'),
    F.coalesce(enrollment_processed['schoolId'], assessment_processed['schoolId'], attendance_processed['schoolId']).alias('schoolId'),
    F.coalesce(enrollment_processed['academicYearId'], assessment_processed['academicYearId'], attendance_processed['academicYearId']).alias('academicYearId'),
    F.coalesce(enrollment_processed['totalStudents'], F.lit(0)).alias('totalStudents'),
    F.coalesce(attendance_processed['avgAttendanceRate'], F.lit(0.0)).alias('avgAttendanceRate'),
    F.coalesce(assessment_processed['avgGPA'], F.lit(0.0)).alias('avgGPA'),
    F.coalesce(assessment_processed['atRiskCount'], F.lit(0)).alias('atRiskCount')
).withColumn('lastUpdated', F.current_timestamp().cast('string'))

# Add partition columns
print("Adding partition columns...")
principal_dashboard = principal_dashboard.withColumn('year', F.date_format(F.current_date(), 'yyyy')) \
                                          .withColumn('month', F.date_format(F.current_date(), 'MM')) \
                                          .withColumn('day', F.date_format(F.current_date(), 'dd'))

# Convert back to DynamicFrame
print("Converting to DynamicFrame...")
principal_dashboard_dynamic = DynamicFrame.fromDF(principal_dashboard, glueContext, "principal_dashboard")

# Write to S3 in Parquet format with partitioning
print(f"Writing to {output_path}...")
glueContext.write_dynamic_frame.from_options(
    frame=principal_dashboard_dynamic,
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

