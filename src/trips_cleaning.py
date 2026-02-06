# =========================
# 0. Imports & Spark session
# =========================

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    TimestampType,
    DoubleType,
)
import os

# Create / get Spark session
spark = (
    SparkSession.builder.appName("Bluebikes Data Cleaning")
    .master("local[*]")
    .config("spark.driver.memory", "4g")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

print("✅ Spark session ready")


# =========================
# 1. Paths (repo‑relative)
# =========================

# Assume notebook lives in notebooks/development/; go two levels up to repo root
BASE_DIR = os.path.abspath(os.path.join(os.getcwd(), "..", ".."))

RAW_2023_DIR = os.path.join(BASE_DIR, "data", "raw", "2023")
RAW_2024_DIR = os.path.join(BASE_DIR, "data", "raw", "2024")
PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")

os.makedirs(PROCESSED_DIR, exist_ok=True)

print("📁 BASE_DIR:", BASE_DIR)
print("📁 RAW_2023_DIR:", RAW_2023_DIR)
print("📁 RAW_2024_DIR:", RAW_2024_DIR)
print("📁 PROCESSED_DIR:", PROCESSED_DIR)


# ==========================================
# 2. Unified target schema for trips (new)
# ==========================================

TRIPS_SCHEMA = StructType(
    [
        StructField("ride_id", StringType(), True),
        StructField("rideable_type", StringType(), True),
        StructField("started_at", TimestampType(), True),
        StructField("ended_at", TimestampType(), True),
        StructField("start_station_name", StringType(), True),
        StructField("start_station_id", StringType(), True),
        StructField("end_station_name", StringType(), True),
        StructField("end_station_id", StringType(), True),
        StructField("start_lat", DoubleType(), True),
        StructField("start_lng", DoubleType(), True),
        StructField("end_lat", DoubleType(), True),
        StructField("end_lng", DoubleType(), True),
        StructField("member_casual", StringType(), True),
    ]
)


# ==========================================================
# 3. Helpers: load CSVs, normalize old/new schemas, clean
# ==========================================================

def read_csv_folder(path_pattern: str):
    """
    Read all CSVs under a folder using header + inferSchema.
    path_pattern should be something like '/path/to/2023/*.csv'.
    """
    print(f"📥 Loading CSVs from: {path_pattern}")
    df = (
        spark.read.option("header", True)
        .option("inferSchema", True)
        .csv(path_pattern)
    )
    print(f"   → {df.count():,} records")
    return df


def normalize_columns(df):
    """
    Normalize columns from old Bluebikes schema to the unified 2023+ schema.
    Handles both:
      - old: tripduration, starttime, stoptime, start station id, ...
      - new: ride_id, rideable_type, started_at, ended_at, ...
    """

    cols = set(df.columns)

    # Detect old schema (tripduration/starttime/stoptime)
    is_old = "tripduration" in cols or "starttime" in cols

    if is_old:
        # Old schema → rename to new schema
        mapping = {
            "starttime": "started_at",
            "stoptime": "ended_at",
            "start station name": "start_station_name",
            "start station id": "start_station_id",
            "end station name": "end_station_name",
            "end station id": "end_station_id",
            "start station latitude": "start_lat",
            "start station longitude": "start_lng",
            "end station latitude": "end_lat",
            "end station longitude": "end_lng",
            # tripduration we can keep separately if needed
        }

        for old_col, new_col in mapping.items():
            if old_col in df.columns:
                df = df.withColumnRenamed(old_col, new_col)

        # Old data has no ride_id / rideable_type / member_casual
        # We create placeholders to match the new schema
        if "ride_id" not in df.columns:
            df = df.withColumn("ride_id", F.monotonically_increasing_id().cast("string"))
        if "rideable_type" not in df.columns:
            df = df.withColumn("rideable_type", F.lit(None).cast("string"))
        if "member_casual" not in df.columns:
            df = df.withColumn("member_casual", F.lit(None).cast("string"))

        # Ensure lat/lng names exist
        for col_name in ["start_lat", "start_lng", "end_lat", "end_lng"]:
            if col_name not in df.columns:
                df = df.withColumn(col_name, F.lit(None).cast("double"))

    # Detect new schema (already 2023+)
    # We just ensure all columns in TRIPS_SCHEMA exist
    for field in TRIPS_SCHEMA.fields:
        if field.name not in df.columns:
            df = df.withColumn(field.name, F.lit(None).cast(field.dataType))

    # Select in correct order
    df = df.select([f.name for f in TRIPS_SCHEMA.fields])

    return df


def cast_to_schema(df):
    """
    Cast columns to the exact types in TRIPS_SCHEMA.
    """
    for field in TRIPS_SCHEMA.fields:
        df = df.withColumn(field.name, F.col(field.name).cast(field.dataType))
    return df


def apply_basic_filters(df):
    """
    Basic data‑quality filters:
      - Drop rows with null started_at or ended_at
      - Drop rows with null start_station_id or end_station_id
      - Drop negative or >24h durations
    """
    # Drop missing critical fields
    df = df.dropna(
        subset=["started_at", "ended_at", "start_station_id", "end_station_id"]
    )

    # Duration in seconds
    df = df.withColumn(
        "trip_duration_sec",
        F.col("ended_at").cast("long") - F.col("started_at").cast("long"),
    )

    # Filter durations: > 0 and < 24h
    df = df.filter((F.col("trip_duration_sec") > 0) & (F.col("trip_duration_sec") <= 24 * 3600))

    return df


def compute_station_hour_demand(df):
    """
    Aggregate to station‑hour level: trips_out per start_station_id per hour.
    """
    df = df.withColumn("started_hour", F.date_trunc("hour", F.col("started_at")))

    hourly = (
        df.groupBy("start_station_id", "started_hour")
        .agg(F.count("*").alias("trips_out"))
    )

    # Rename columns for clarity
    hourly = hourly.withColumnRenamed("start_station_id", "station_id") \
                   .withColumnRenamed("started_hour", "timestamp_hour")

    return hourly


# ===================================
# 4. Load raw data (2023, 2024, etc.)
# ===================================

# Use wildcard patterns inside folders
PATH_2023 = os.path.join(RAW_2023_DIR, "*.csv")
PATH_2024 = os.path.join(RAW_2024_DIR, "*.csv")

df_2023_raw = read_csv_folder(PATH_2023)
df_2024_raw = read_csv_folder(PATH_2024)

# You can extend this if later you add 2022, etc.
raw_union = df_2023_raw.unionByName(df_2024_raw, allowMissingColumns=True)
print(f"📊 Raw union total: {raw_union.count():,} records")


# =========================================
# 5. Normalize, cast, and apply QC filters
# =========================================

# Normalize column names & structure
df_normalized = normalize_columns(raw_union)

# Cast to target schema types
df_typed = cast_to_schema(df_normalized)

# Basic data‑quality filters
df_clean = apply_basic_filters(df_typed)

print(f"✅ Cleaned trips: {df_clean.count():,} records")

# Optional: quick missing analysis on cleaned data
print("\n🔍 Missing values (cleaned data):")
total_clean = df_clean.count()
for col_name in df_clean.columns:
    null_cnt = df_clean.filter(F.col(col_name).isNull()).count()
    if null_cnt > 0:
        print(f"  {col_name:<25} {null_cnt:>10,} ({null_cnt / total_clean * 100:6.2f}%)")


# =====================================================
# 6. Aggregate to station‑hour demand and write outputs
# =====================================================

df_hourly = compute_station_hour_demand(df_clean)
print(f"📈 Station‑hour rows: {df_hourly.count():,}")

# Write cleaned trips and hourly aggregates to parquet
clean_trips_path = os.path.join(PROCESSED_DIR, "trips_clean.parquet")
hourly_demand_path = os.path.join(PROCESSED_DIR, "trips_by_station_hour.parquet")

(
    df_clean.repartition(16)  # adjust partitions based on data size
    .write.mode("overwrite")
    .parquet(clean_trips_path)
)
(
    df_hourly.repartition(8)
    .write.mode("overwrite")
    .parquet(hourly_demand_path)
)

print("💾 Saved:")
print("  -", clean_trips_path)
print("  -", hourly_demand_path)
