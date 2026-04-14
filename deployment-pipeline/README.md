# Deployment Pipeline

This folder contains the reusable deployment and monitoring logic for BlueForecast.

GitHub Actions workflow files remain in `.github/workflows/` because GitHub only
executes workflows from that location. Those workflow files now act as thin
entrypoints that call the scripts in this folder.

## Structure

- `scripts/deploy_dashboard.sh` builds and pushes the API and dashboard images.
- `scripts/refresh_serving.sh` refreshes the Cloud Run API revision after a new model is promoted.
- `scripts/verify_deployment.sh` checks the deployed API health endpoint.
- `monitoring/retrain_and_promote.py` runs the end-to-end retraining, validation,
  promotion, and prediction refresh loop for the model pipeline.

## Local Usage

Example dashboard deployment commands:

```bash
bash deployment-pipeline/scripts/deploy_dashboard.sh build-push
bash deployment-pipeline/scripts/deploy_dashboard.sh deploy
```

Example serving refresh:

```bash
bash deployment-pipeline/scripts/refresh_serving.sh
```

Example model retraining:

```bash
python3 deployment-pipeline/monitoring/retrain_and_promote.py
```
