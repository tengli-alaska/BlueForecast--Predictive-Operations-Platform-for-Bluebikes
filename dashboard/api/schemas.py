from pydantic import BaseModel
from typing import Optional


class Station(BaseModel):
    station_id: str
    station_name: str
    lat: float
    lon: float
    capacity: int
    has_kiosk: bool = True


class Prediction(BaseModel):
    station_id: str
    forecast_hour: str
    predicted_demand: float
    model_version: int
    generated_at: str


class HealthResponse(BaseModel):
    status: str
    gcs_connected: bool
    bucket: str
