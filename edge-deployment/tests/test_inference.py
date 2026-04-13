"""
BlueForecast Edge Deployment — Unit Tests
==========================================
Tests for the edge inference server and ONNX model validation.

Run:
    pytest tests/test_inference.py -v
"""

import json
import os
import sys

import numpy as np
import pytest

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ─────────────────────────────────────────────────────────────────────────────
# Test 1: Feature schema consistency
# ─────────────────────────────────────────────────────────────────────────────
class TestFeatureSchema:
    """Ensure feature schema matches between export and inference."""

    def test_feature_count(self):
        """Feature columns should have exactly 28 features."""
        from inference_server import FEATURE_COLUMNS
        assert len(FEATURE_COLUMNS) == 28, f"Expected 28 features, got {len(FEATURE_COLUMNS)}"

    def test_feature_columns_match_export(self):
        """Feature columns in server must match export script."""
        from export_to_onnx import FEATURE_COLUMNS as EXPORT_COLS
        from inference_server import FEATURE_COLUMNS as SERVER_COLS
        assert EXPORT_COLS == SERVER_COLS, "Feature columns mismatch between export and server"

    def test_no_duplicate_features(self):
        """No duplicate feature names."""
        from inference_server import FEATURE_COLUMNS
        assert len(FEATURE_COLUMNS) == len(set(FEATURE_COLUMNS)), "Duplicate feature names found"

    def test_required_features_present(self):
        """Key features must be present."""
        from inference_server import FEATURE_COLUMNS
        required = [
            "start_station_id", "capacity", "hour_of_day", "temperature_c",
            "demand_lag_1h", "demand_lag_24h", "hour_sin", "hour_cos",
        ]
        for feat in required:
            assert feat in FEATURE_COLUMNS, f"Missing required feature: {feat}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: Cyclical feature computation
# ─────────────────────────────────────────────────────────────────────────────
class TestCyclicalFeatures:
    """Test that cyclical encodings are computed correctly."""

    def test_hour_sin_cos_range(self):
        """Sin/cos values must be between -1 and 1."""
        from math import cos, pi, sin
        for hour in range(24):
            h_sin = sin(2 * pi * hour / 24)
            h_cos = cos(2 * pi * hour / 24)
            assert -1 <= h_sin <= 1, f"hour_sin out of range for hour={hour}"
            assert -1 <= h_cos <= 1, f"hour_cos out of range for hour={hour}"

    def test_hour_midnight_values(self):
        """Hour 0 (midnight): sin≈0, cos≈1."""
        from math import cos, pi, sin
        assert abs(sin(2 * pi * 0 / 24)) < 1e-10
        assert abs(cos(2 * pi * 0 / 24) - 1.0) < 1e-10

    def test_dow_sin_cos_range(self):
        """Day-of-week cyclical values must be in range."""
        from math import cos, pi, sin
        for dow in range(7):
            d_sin = sin(2 * pi * dow / 7)
            d_cos = cos(2 * pi * dow / 7)
            assert -1 <= d_sin <= 1
            assert -1 <= d_cos <= 1

    def test_month_sin_cos_range(self):
        """Month cyclical values must be in range."""
        from math import cos, pi, sin
        for month in range(1, 13):
            m_sin = sin(2 * pi * month / 12)
            m_cos = cos(2 * pi * month / 12)
            assert -1 <= m_sin <= 1
            assert -1 <= m_cos <= 1


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: Request to array conversion
# ─────────────────────────────────────────────────────────────────────────────
class TestRequestConversion:
    """Test conversion of API requests to numpy arrays."""

    def _make_sample_request(self):
        from inference_server import PredictionRequest
        return PredictionRequest(
            start_station_id=100,
            capacity=19,
            hour_of_day=8,
            day_of_week=1,
            month=6,
            year=2024,
            is_weekend=0,
            is_holiday=0,
            temperature_c=22.5,
            precipitation_mm=0.0,
            wind_speed_kmh=12.0,
            humidity_pct=65.0,
            feels_like_c=21.0,
            is_cold=0,
            is_hot=0,
            is_precipitation=0,
            demand_lag_1h=5.0,
            demand_lag_24h=8.0,
            demand_lag_168h=7.0,
            rolling_avg_3h=4.5,
            rolling_avg_6h=5.2,
            rolling_avg_24h=6.1,
        )

    def test_array_shape(self):
        """Output array must be (1, 28)."""
        from inference_server import _request_to_array
        req = self._make_sample_request()
        arr = _request_to_array(req)
        assert arr.shape == (1, 28), f"Expected (1, 28), got {arr.shape}"

    def test_array_dtype(self):
        """Output array must be float32 for ONNX."""
        from inference_server import _request_to_array
        req = self._make_sample_request()
        arr = _request_to_array(req)
        assert arr.dtype == np.float32, f"Expected float32, got {arr.dtype}"

    def test_station_id_preserved(self):
        """Station ID should be first feature."""
        from inference_server import _request_to_array
        req = self._make_sample_request()
        arr = _request_to_array(req)
        assert arr[0, 0] == 100.0

    def test_cyclical_auto_computed(self):
        """Cyclical features should be auto-computed when not provided."""
        from inference_server import _request_to_array
        req = self._make_sample_request()
        arr = _request_to_array(req)
        # hour_sin and hour_cos (indices 22, 23) should not be zero for hour=8
        assert arr[0, 22] != 0.0, "hour_sin should be non-zero for hour=8"
        assert arr[0, 23] != 0.0, "hour_cos should be non-zero for hour=8"

    def test_no_nan_values(self):
        """Output array must have no NaN values."""
        from inference_server import _request_to_array
        req = self._make_sample_request()
        arr = _request_to_array(req)
        assert not np.any(np.isnan(arr)), "Array contains NaN values"


# ─────────────────────────────────────────────────────────────────────────────
# Test 4: ONNX model validation (only runs if model file exists)
# ─────────────────────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model", "blueforecast.onnx")


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="ONNX model not found — run export_to_onnx.py first")
class TestONNXModel:
    """Test the exported ONNX model."""

    def test_model_loads(self):
        """ONNX model should load without errors."""
        import onnxruntime as ort
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        assert session is not None

    def test_model_input_shape(self):
        """Model should expect (batch, 28) input."""
        import onnxruntime as ort
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        input_shape = session.get_inputs()[0].shape
        assert input_shape[1] == 28, f"Expected 28 features, model expects {input_shape[1]}"

    def test_model_single_prediction(self):
        """Model should return a single prediction for a single input."""
        import onnxruntime as ort
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        sample = np.random.rand(1, 28).astype(np.float32)
        input_name = session.get_inputs()[0].name
        result = session.run(None, {input_name: sample})
        assert result[0].shape[0] == 1

    def test_model_batch_prediction(self):
        """Model should handle batch predictions."""
        import onnxruntime as ort
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        batch = np.random.rand(50, 28).astype(np.float32)
        input_name = session.get_inputs()[0].name
        result = session.run(None, {input_name: batch})
        assert result[0].flatten().shape[0] == 50

    def test_model_output_reasonable(self):
        """Predictions should be finite numbers."""
        import onnxruntime as ort
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        sample = np.random.rand(5, 28).astype(np.float32)
        input_name = session.get_inputs()[0].name
        result = session.run(None, {input_name: sample})
        predictions = result[0].flatten()
        assert np.all(np.isfinite(predictions)), "Model produced non-finite predictions"

    def test_model_file_size(self):
        """ONNX model should be reasonably small for edge (<50MB)."""
        size_mb = os.path.getsize(MODEL_PATH) / (1024 * 1024)
        assert size_mb < 50, f"Model too large for edge: {size_mb:.1f} MB"


# ─────────────────────────────────────────────────────────────────────────────
# Test 5: API endpoint tests (integration)
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="ONNX model not found — run export_to_onnx.py first")
class TestAPIEndpoints:
    """Test FastAPI endpoints using TestClient."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from inference_server import app
        return TestClient(app)

    def test_health_endpoint(self, client):
        """GET /health should return 200."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["model_loaded"] is True

    def test_model_info_endpoint(self, client):
        """GET /model-info should return metadata."""
        response = client.get("/model-info")
        assert response.status_code == 200

    def test_predict_endpoint(self, client):
        """POST /predict should return a valid prediction."""
        payload = {
            "start_station_id": 100,
            "capacity": 19,
            "hour_of_day": 8,
            "day_of_week": 1,
            "month": 6,
            "year": 2024,
            "is_weekend": 0,
            "is_holiday": 0,
            "temperature_c": 22.5,
            "precipitation_mm": 0.0,
            "wind_speed_kmh": 12.0,
            "humidity_pct": 65.0,
            "feels_like_c": 21.0,
            "is_cold": 0,
            "is_hot": 0,
            "is_precipitation": 0,
            "demand_lag_1h": 5.0,
            "demand_lag_24h": 8.0,
            "demand_lag_168h": 7.0,
            "rolling_avg_3h": 4.5,
            "rolling_avg_6h": 5.2,
            "rolling_avg_24h": 6.1,
        }
        response = client.post("/predict", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["station_id"] == 100
        assert data["predicted_demand"] >= 0
        assert "inference_time_ms" in data

    def test_predict_batch_endpoint(self, client):
        """POST /predict/batch should handle multiple stations."""
        single = {
            "start_station_id": 100,
            "capacity": 19,
            "hour_of_day": 8,
            "day_of_week": 1,
            "month": 6,
            "year": 2024,
            "is_weekend": 0,
            "is_holiday": 0,
            "temperature_c": 22.5,
            "precipitation_mm": 0.0,
            "wind_speed_kmh": 12.0,
            "humidity_pct": 65.0,
            "feels_like_c": 21.0,
            "is_cold": 0,
            "is_hot": 0,
            "is_precipitation": 0,
            "demand_lag_1h": 5.0,
            "demand_lag_24h": 8.0,
            "demand_lag_168h": 7.0,
            "rolling_avg_3h": 4.5,
            "rolling_avg_6h": 5.2,
            "rolling_avg_24h": 6.1,
        }
        payload = {"predictions": [single, single, single]}
        response = client.post("/predict/batch", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 3
        assert len(data["predictions"]) == 3

    def test_predict_negative_demand_clamped(self, client):
        """Predictions should never be negative."""
        payload = {
            "start_station_id": 999,
            "capacity": 5,
            "hour_of_day": 3,
            "day_of_week": 2,
            "month": 1,
            "year": 2024,
            "is_weekend": 0,
            "is_holiday": 0,
            "temperature_c": -10.0,
            "precipitation_mm": 5.0,
            "wind_speed_kmh": 40.0,
            "humidity_pct": 95.0,
            "feels_like_c": -18.0,
            "is_cold": 1,
            "is_hot": 0,
            "is_precipitation": 1,
            "demand_lag_1h": 0.0,
            "demand_lag_24h": 0.0,
            "demand_lag_168h": 0.0,
            "rolling_avg_3h": 0.0,
            "rolling_avg_6h": 0.0,
            "rolling_avg_24h": 0.0,
        }
        response = client.post("/predict", json=payload)
        assert response.status_code == 200
        assert response.json()["predicted_demand"] >= 0


# ─────────────────────────────────────────────────────────────────────────────
# Test 6: Metadata file validation
# ─────────────────────────────────────────────────────────────────────────────
METADATA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "model", "model_metadata.json")


@pytest.mark.skipif(not os.path.exists(METADATA_PATH), reason="Metadata not found — run export_to_onnx.py first")
class TestMetadata:
    """Validate exported metadata file."""

    def test_metadata_loads(self):
        with open(METADATA_PATH) as f:
            data = json.load(f)
        assert "run_id" in data
        assert "feature_columns" in data

    def test_metadata_feature_count(self):
        with open(METADATA_PATH) as f:
            data = json.load(f)
        assert data["num_features"] == 28

    def test_metadata_onnx_validation_passed(self):
        with open(METADATA_PATH) as f:
            data = json.load(f)
        assert data["onnx_validation"]["status"] == "PASSED"
