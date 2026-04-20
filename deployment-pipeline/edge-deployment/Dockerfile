# ─────────────────────────────────────────────────────────────────────────────
# BlueForecast Edge Deployment — Lightweight Docker Image
# ─────────────────────────────────────────────────────────────────────────────
# This image runs the ONNX inference server with ZERO cloud dependencies.
# Target: Raspberry Pi, Jetson, edge servers, or any constrained environment.
#
# Build:  docker build -t blueforecast-edge .
# Run:    docker run -p 8080:8080 blueforecast-edge
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# Metadata
LABEL maintainer="Chitra Pahuja <chitrapahuja.cp@gmail.com>"
LABEL description="BlueForecast edge inference server (ONNX + FastAPI)"
LABEL version="1.0.0"

# Prevent Python from writing .pyc and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Install system dependencies (minimal)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY inference_server.py .
COPY config.yaml .

# Copy the ONNX model and metadata
COPY model/ ./model/

# Expose port
EXPOSE 8080

# Health check — Docker and orchestrators use this
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the inference server
CMD ["uvicorn", "inference_server:app", "--host", "0.0.0.0", "--port", "8080"]
