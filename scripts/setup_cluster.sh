#!/bin/bash

# Setup Script for Dataproc Cluster

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}Dataproc Cluster Setup${NC}"
echo -e "${GREEN}=====================================${NC}"

# Configuration
PROJECT_ID="bluebikes-demand-predictor"
REGION="us-east1"
CLUSTER_NAME="bluebikes-processing-cluster"
BUCKET_NAME="${PROJECT_ID}-data"

echo -e "${YELLOW}Project: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Region: ${REGION}${NC}"
echo -e "${YELLOW}Cluster: ${CLUSTER_NAME}${NC}"
echo ""

# Check if cluster already exists
echo -e "${YELLOW}Checking if cluster exists...${NC}"
if gcloud dataproc clusters describe ${CLUSTER_NAME} --region=${REGION} --project=${PROJECT_ID} &> /dev/null; then
    echo -e "${RED}Cluster ${CLUSTER_NAME} already exists!${NC}"
    echo -e "${YELLOW}Do you want to delete and recreate? (y/n)${NC}"
    read -r response
    if [[ "$response" == "y" ]]; then
        echo -e "${YELLOW}Deleting existing cluster...${NC}"
        gcloud dataproc clusters delete ${CLUSTER_NAME} \
            --region=${REGION} \
            --project=${PROJECT_ID} \
            --quiet
        echo -e "${GREEN}✓ Cluster deleted${NC}"
    else
        echo -e "${YELLOW}Using existing cluster${NC}"
        exit 0
    fi
fi

# Create Dataproc cluster
echo -e "${YELLOW}Creating Dataproc cluster (this takes ~90 seconds)...${NC}"

gcloud dataproc clusters create ${CLUSTER_NAME} \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --master-machine-type=n1-standard-4 \
    --master-boot-disk-size=100 \
    --num-workers=2 \
    --worker-machine-type=n1-standard-4 \
    --worker-boot-disk-size=100 \
    --image-version=2.1-debian11 \
    --max-idle=3600s \
    --bucket=${BUCKET_NAME} \
    --enable-component-gateway \
    --optional-components=JUPYTER \
    --properties="spark:spark.executor.memory=4g,spark:spark.driver.memory=4g"

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}✓ Cluster created successfully!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${YELLOW}Cluster details:${NC}"
gcloud dataproc clusters describe ${CLUSTER_NAME} \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --format="table(clusterName,config.masterConfig.numInstances,config.workerConfig.numInstances,status.state)"

echo ""
echo -e "${GREEN}Next steps:${NC}"
echo -e "1. Write your PySpark job in: ${YELLOW}jobs/process_historical.py${NC}"
echo -e "2. Submit job with: ${YELLOW}bash scripts/submit_job.sh${NC}"
echo ""
