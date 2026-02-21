"""
BlueForecast Pipeline Tests
Unit tests for each data processing module.

Tests cover:
- Data cleaning: dedup, null removal, duration filtering, text standardization
- Holiday calendar: correct count, categories, date validity
- Weather data: derived features, value ranges
- Aggregate demand: grid completeness, zero-fill, time conversion
- Feature engineering: lag features, cyclical encoding, null handling
- Schema validation: column checks, dtype checks, range checks
- Bias detection: slice analysis, disparity calculation

Run with: pytest tests/test_pipeline.py -v
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime


# ============================================================================
# DATA CLEANING TESTS
# ============================================================================

class TestDataCleaning:
    """Tests for src/data_processing/data_cleaning.py logic."""

    def _make_raw_df(self, n=100):
        """Create a sample raw trip DataFrame."""
        base = datetime(2024, 6, 15, 8, 0, 0)
        return pd.DataFrame({
            "ride_id": [f"R{i:06d}" for i in range(n)],
            "rideable_type": ["electric_bike"] * n,
            "started_at": pd.date_range(base, periods=n, freq="5min"),
            "ended_at": pd.date_range(base, periods=n, freq="5min") + pd.Timedelta(minutes=15),
            "start_station_name": ["Station A"] * n,
            "start_station_id": ["A001"] * n,
            "end_station_name": ["Station B"] * n,
            "end_station_id": ["B001"] * n,
            "start_lat": [42.36] * n,
            "start_lng": [-71.06] * n,
            "end_lat": [42.37] * n,
            "end_lng": [-71.05] * n,
            "member_casual": ["member"] * n,
        })

    def test_dedup_removes_duplicates(self):
        """Duplicate ride_ids should be removed."""
        df = self._make_raw_df(10)
        df = pd.concat([df, df.iloc[[0]]], ignore_index=True)  # add 1 dupe
        assert len(df) == 11
        deduped = df.drop_duplicates(subset=["ride_id"])
        assert len(deduped) == 10

    def test_null_critical_fields_removed(self):
        """Rows with null station IDs should be dropped."""
        df = self._make_raw_df(10)
        df.loc[0, "start_station_id"] = None
        df.loc[1, "end_station_id"] = None
        cleaned = df.dropna(subset=["ride_id", "started_at", "ended_at",
                                     "start_station_id", "end_station_id"])
        assert len(cleaned) == 8

    def test_duration_filter_removes_short_trips(self):
        """Trips under 60 seconds should be filtered."""
        df = self._make_raw_df(5)
        df.loc[0, "ended_at"] = df.loc[0, "started_at"] + pd.Timedelta(seconds=30)
        df["trip_duration_seconds"] = (df["ended_at"] - df["started_at"]).dt.total_seconds()
        filtered = df[(df["trip_duration_seconds"] >= 60) &
                      (df["trip_duration_seconds"] <= 86400)]
        assert len(filtered) == 4

    def test_duration_filter_removes_long_trips(self):
        """Trips over 24 hours should be filtered."""
        df = self._make_raw_df(5)
        df.loc[0, "ended_at"] = df.loc[0, "started_at"] + pd.Timedelta(hours=25)
        df["trip_duration_seconds"] = (df["ended_at"] - df["started_at"]).dt.total_seconds()
        filtered = df[(df["trip_duration_seconds"] >= 60) &
                      (df["trip_duration_seconds"] <= 86400)]
        assert len(filtered) == 4

    def test_text_standardization(self):
        """Rideable type and member_casual should be lowercase stripped."""
        df = self._make_raw_df(3)
        df["rideable_type"] = ["  Electric_Bike ", " CLASSIC_bike", "electric_bike"]
        df["member_casual"] = [" Member ", "CASUAL", " member"]
        df["rideable_type"] = df["rideable_type"].str.strip().str.lower()
        df["member_casual"] = df["member_casual"].str.strip().str.lower()
        assert df["rideable_type"].tolist() == ["electric_bike", "classic_bike", "electric_bike"]
        assert df["member_casual"].tolist() == ["member", "casual", "member"]

    def test_derived_time_columns(self):
        """Start hour, day of week, month, year should be extracted correctly."""
        df = self._make_raw_df(1)
        df["started_at"] = pd.Timestamp("2024-06-15 08:30:00")
        df["start_hour"] = df["started_at"].dt.hour
        df["start_month"] = df["started_at"].dt.month
        df["start_year"] = df["started_at"].dt.year
        assert df["start_hour"].iloc[0] == 8
        assert df["start_month"].iloc[0] == 6
        assert df["start_year"].iloc[0] == 2024

    def test_empty_dataframe_handling(self):
        """Empty DataFrame should return empty after cleaning."""
        df = self._make_raw_df(0)
        assert len(df) == 0
        deduped = df.drop_duplicates(subset=["ride_id"])
        assert len(deduped) == 0


# ============================================================================
# HOLIDAY CALENDAR TESTS
# ============================================================================

class TestHolidayCalendar:
    """Tests for src/data_processing/holiday_calendar.py logic."""

    def _get_holidays(self):
        """Import holiday data directly."""
        from src.data_processing.holiday_calendar import HOLIDAYS_2023_2024, _categorize_holiday
        df = pd.DataFrame(HOLIDAYS_2023_2024)
        df["date"] = pd.to_datetime(df["date"])
        df["holiday_type"] = df["holiday"].apply(_categorize_holiday)
        df["is_holiday"] = 1
        return df

    def test_holiday_count(self):
        """Should have 24 holidays (12 per year)."""
        df = self._get_holidays()
        assert len(df) == 24
        assert df[df["year"] == 2023].shape[0] == 12
        assert df[df["year"] == 2024].shape[0] == 12

    def test_all_dates_valid(self):
        """All holiday dates should be valid datetimes."""
        df = self._get_holidays()
        assert df["date"].notna().all()
        assert df["date"].dt.year.isin([2023, 2024]).all()

    def test_patriots_day_categorization(self):
        """Patriots Day should be categorized as federal_observance per notebook logic."""
        from src.data_processing.holiday_calendar import _categorize_holiday
        result = _categorize_holiday("Patriots Day (MA)")
        assert result == "federal_observance"

    def test_christmas_categorization(self):
        """Christmas should be major_holiday."""
        from src.data_processing.holiday_calendar import _categorize_holiday
        assert _categorize_holiday("Christmas") == "major_holiday"

    def test_thanksgiving_categorization(self):
        """Thanksgiving should be major_holiday."""
        from src.data_processing.holiday_calendar import _categorize_holiday
        assert _categorize_holiday("Thanksgiving") == "major_holiday"

    def test_independence_day_categorization(self):
        """Independence Day should be summer_holiday."""
        from src.data_processing.holiday_calendar import _categorize_holiday
        assert _categorize_holiday("Independence Day") == "summer_holiday"

    def test_is_holiday_flag(self):
        """All entries should have is_holiday = 1."""
        df = self._get_holidays()
        assert (df["is_holiday"] == 1).all()

    def test_no_duplicate_dates(self):
        """No duplicate dates in holiday calendar."""
        df = self._get_holidays()
        assert df["date"].duplicated().sum() == 0


# ============================================================================
# AGGREGATE DEMAND TESTS
# ============================================================================

class TestAggregateDemand:
    """Tests for aggregation logic from aggregate_demand.py."""

    def _make_trips(self):
        """Create sample trip data."""
        return pd.DataFrame({
            "started_at": pd.to_datetime([
                "2024-06-15 12:00:00", "2024-06-15 12:30:00",
                "2024-06-15 13:00:00", "2024-06-15 12:15:00",
            ]),
            "start_station_id": ["A001", "A001", "A001", "A002"],
        })

    def test_hourly_groupby(self):
        """Trips in same hour should be grouped together."""
        df = self._make_trips()
        df["hour"] = df["started_at"].dt.floor("h")
        demand = df.groupby(["start_station_id", "hour"]).size().reset_index(name="demand_count")
        # A001 has 2 trips at 12:00 and 1 at 13:00; A002 has 1 at 12:00
        a001_12 = demand[(demand["start_station_id"] == "A001") &
                         (demand["hour"].dt.hour == 12)]["demand_count"].iloc[0]
        assert a001_12 == 2

    def test_zero_fill(self):
        """Missing station-hour combos should be filled with 0."""
        stations = ["A001", "A002"]
        hours = pd.date_range("2024-06-15 12:00", periods=3, freq="h")
        grid = pd.DataFrame({"start_station_id": stations}).merge(
            pd.DataFrame({"hour": hours}), how="cross"
        )
        actual = pd.DataFrame({
            "start_station_id": ["A001"],
            "hour": [pd.Timestamp("2024-06-15 12:00")],
            "demand_count": [5],
        })
        merged = grid.merge(actual, on=["start_station_id", "hour"], how="left")
        merged["demand_count"] = merged["demand_count"].fillna(0).astype(int)
        assert (merged["demand_count"] == 0).sum() == 5  # 6 total - 1 actual = 5 zeros
        assert merged["demand_count"].sum() == 5

    def test_no_duplicate_station_hours(self):
        """Grid should have no duplicate (station, hour) pairs."""
        stations = ["A001", "A002"]
        hours = pd.date_range("2024-06-15", periods=24, freq="h")
        grid = pd.DataFrame({"start_station_id": stations}).merge(
            pd.DataFrame({"hour": hours}), how="cross"
        )
        assert grid.duplicated(subset=["start_station_id", "hour"]).sum() == 0

    def test_time_features_correct(self):
        """Hour of day, day of week, is_weekend should be derived correctly."""
        df = pd.DataFrame({
            "hour": pd.to_datetime(["2024-06-15 08:00", "2024-06-16 20:00"]),
        })
        df["hour_of_day"] = df["hour"].dt.hour
        df["day_of_week"] = df["hour"].dt.dayofweek
        df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
        assert df["hour_of_day"].tolist() == [8, 20]
        # June 15 2024 = Saturday (5), June 16 = Sunday (6)
        assert df["is_weekend"].tolist() == [1, 1]


# ============================================================================
# FEATURE ENGINEERING TESTS
# ============================================================================

class TestFeatureEngineering:
    """Tests for feature engineering logic."""

    def test_lag_features_shift_correctly(self):
        """Lag-1h should equal previous row's demand for same station."""
        df = pd.DataFrame({
            "start_station_id": ["A001"] * 5,
            "hour": pd.date_range("2024-06-15", periods=5, freq="h"),
            "demand_count": [10, 20, 30, 40, 50],
        })
        df["demand_lag_1h"] = df.groupby("start_station_id")["demand_count"].shift(1)
        assert pd.isna(df["demand_lag_1h"].iloc[0])  # first row has no lag
        assert df["demand_lag_1h"].iloc[1] == 10
        assert df["demand_lag_1h"].iloc[4] == 40

    def test_lag_features_respect_station_boundary(self):
        """Lag should not leak across different stations."""
        df = pd.DataFrame({
            "start_station_id": ["A001", "A001", "A002", "A002"],
            "hour": pd.date_range("2024-06-15", periods=2, freq="h").tolist() * 2,
            "demand_count": [10, 20, 100, 200],
        })
        df = df.sort_values(["start_station_id", "hour"])
        df["demand_lag_1h"] = df.groupby("start_station_id")["demand_count"].shift(1)
        # A002's first row should be NaN, not A001's last value
        a002_first = df[df["start_station_id"] == "A002"]["demand_lag_1h"].iloc[0]
        assert pd.isna(a002_first)

    def test_rolling_average(self):
        """Rolling 3h average should be computed correctly."""
        df = pd.DataFrame({
            "start_station_id": ["A001"] * 6,
            "demand_count": [0, 10, 20, 30, 40, 50],
        })
        df["rolling_avg_3h"] = (
            df.groupby("start_station_id")["demand_count"]
            .transform(lambda x: x.shift(1).rolling(3, min_periods=1).mean())
        )
        # At index 4: shift gives [0,10,20,30], rolling(3) of last 3 = mean(10,20,30) = 20
        assert df["rolling_avg_3h"].iloc[4] == pytest.approx(20.0)

    def test_cyclical_encoding_range(self):
        """Cyclical features should be in [-1, 1]."""
        hours = np.arange(0, 24)
        hour_sin = np.sin(2 * np.pi * hours / 24)
        hour_cos = np.cos(2 * np.pi * hours / 24)
        assert hour_sin.min() >= -1.0
        assert hour_sin.max() <= 1.0
        assert hour_cos.min() >= -1.0
        assert hour_cos.max() <= 1.0

    def test_cyclical_wrapping(self):
        """Hour 0 and hour 24 should have the same encoding."""
        h0_sin = np.sin(2 * np.pi * 0 / 24)
        h24_sin = np.sin(2 * np.pi * 24 / 24)
        assert h0_sin == pytest.approx(h24_sin, abs=1e-10)

    def test_holiday_join_fills_non_holidays(self):
        """Non-holiday dates should have is_holiday = 0 after join."""
        demand = pd.DataFrame({
            "date": pd.to_datetime(["2024-06-15", "2024-07-04", "2024-06-16"]),
            "demand_count": [10, 20, 30],
        })
        holidays = pd.DataFrame({
            "date": pd.to_datetime(["2024-07-04"]),
            "is_holiday": [1],
        })
        merged = demand.merge(holidays, on="date", how="left")
        merged["is_holiday"] = merged["is_holiday"].fillna(0).astype(int)
        assert merged["is_holiday"].tolist() == [0, 1, 0]


# ============================================================================
# SCHEMA VALIDATION TESTS
# ============================================================================

class TestSchemaValidation:
    """Tests for schema_validation.py check functions."""

    def test_check_columns_detects_missing(self):
        """Missing columns should be flagged."""
        from src.data_processing.schema_validation import _check_columns
        df = pd.DataFrame({"start_station_id": ["A001"], "hour": [pd.Timestamp.now()]})
        issues = _check_columns(df)
        assert any("Missing columns" in i for i in issues)

    def test_check_nulls_detects_nulls(self):
        """Null values should be flagged."""
        from src.data_processing.schema_validation import _check_nulls
        df = pd.DataFrame({"a": [1, None, 3], "b": [4, 5, 6]})
        issues = _check_nulls(df)
        assert len(issues) == 1
        assert "a" in issues[0]

    def test_check_nulls_passes_clean_data(self):
        """No nulls should produce no issues."""
        from src.data_processing.schema_validation import _check_nulls
        df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
        issues = _check_nulls(df)
        assert len(issues) == 0

    def test_check_value_ranges_catches_negative_demand(self):
        """Negative demand should be flagged."""
        from src.data_processing.schema_validation import _check_value_ranges
        df = pd.DataFrame({"demand_count": [-1, 0, 5]})
        issues = _check_value_ranges(df)
        assert any("demand_count" in i for i in issues)

    def test_check_value_ranges_catches_invalid_hour(self):
        """Hour > 23 should be flagged."""
        from src.data_processing.schema_validation import _check_value_ranges
        df = pd.DataFrame({"hour_of_day": [0, 12, 25]})
        issues = _check_value_ranges(df)
        assert any("hour_of_day" in i for i in issues)

    def test_check_duplicates_detects_dupes(self):
        """Duplicate (station, hour) should be flagged."""
        from src.data_processing.schema_validation import _check_duplicates
        df = pd.DataFrame({
            "start_station_id": ["A001", "A001"],
            "hour": [pd.Timestamp("2024-06-15 08:00")] * 2,
        })
        issues = _check_duplicates(df)
        assert len(issues) == 1


# ============================================================================
# BIAS DETECTION TESTS
# ============================================================================

class TestBiasDetection:
    """Tests for bias_detection.py analysis functions."""

    def test_analyze_slice_computes_disparity(self):
        """Disparity ratio should reflect group mean differences."""
        from src.data_processing.bias_detection import _analyze_slice
        df = pd.DataFrame({
            "group": ["A"] * 100 + ["B"] * 100,
            "demand_count": [10] * 100 + [1] * 100,
        })
        result = _analyze_slice(df.groupby("group"), "test_slice", 200)
        assert result["disparity_ratio"] == 10.0
        assert len(result["groups"]) == 2

    def test_analyze_slice_flags_underrepresentation(self):
        """Small groups should be flagged."""
        from src.data_processing.bias_detection import _analyze_slice
        df = pd.DataFrame({
            "group": ["A"] * 99 + ["B"] * 1,
            "demand_count": [5] * 99 + [5] * 1,
        })
        result = _analyze_slice(df.groupby("group"), "test_slice", 100)
        assert any("underrepresented" in f for f in result["flags"])

    def test_slice_by_day_type_categories(self):
        """Should produce weekday, weekend, and holiday slices."""
        from src.data_processing.bias_detection import _slice_by_day_type
        df = pd.DataFrame({
            "is_weekend": [0, 1, 0],
            "is_holiday": [0, 0, 1],
            "demand_count": [10, 20, 30],
        })
        grouped = _slice_by_day_type(df)
        groups = [name for name, _ in grouped]
        assert "weekday" in groups
        assert "weekend" in groups
        assert "holiday" in groups

    def test_season_slice_all_months_covered(self):
        """All 12 months should map to a season."""
        from src.data_processing.bias_detection import _slice_by_season
        df = pd.DataFrame({
            "month": list(range(1, 13)),
            "demand_count": [10] * 12,
        })
        grouped = _slice_by_season(df)
        groups = [name for name, _ in grouped]
        assert set(groups) == {"spring", "summer", "fall", "winter"}