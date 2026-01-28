#!/bin/bash

# Unzip ALL years of Bluebikes data (Mac-compatible, no parallel processing)
# Usage: bash scripts/unzip_all_years.sh
# Or specify years: bash scripts/unzip_all_years.sh 2023 2024

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BUCKET="bluebikes-demand-predictor-data"

# If no arguments, process all years
if [ $# -eq 0 ]; then
    YEARS=(2015 2016 2017 2018 2019 2020 2021 2022 2023 2024)
    echo -e "${YELLOW}No years specified. Processing all years: ${YEARS[@]}${NC}"
else
    YEARS=("$@")
    echo -e "${YELLOW}Processing specified years: ${YEARS[@]}${NC}"
fi

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}Bluebikes Data Unzip Pipeline${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""

TOTAL_YEARS=${#YEARS[@]}
CURRENT=0

for YEAR in "${YEARS[@]}"; do
    CURRENT=$((CURRENT + 1))

    echo -e "${GREEN}[${CURRENT}/${TOTAL_YEARS}] Processing year: ${YEAR}${NC}"

    INPUT_PATH="gs://${BUCKET}/raw/historical/${YEAR}/"
    OUTPUT_PATH="gs://${BUCKET}/raw/historical/${YEAR}/csv/"

    # Check if CSV files already exist
    CSV_EXISTS=$(gsutil ls "${OUTPUT_PATH}*.csv" 2>/dev/null | wc -l || echo 0)

    if [ "$CSV_EXISTS" -gt 0 ]; then
        echo -e "${YELLOW}  ⚠ CSV files already exist for ${YEAR}. Skipping...${NC}"
        continue
    fi

    # Create temp directory
    TEMP_DIR="/tmp/bluebikes_${YEAR}_$$"
    mkdir -p ${TEMP_DIR}

    # Download ZIP files (NO -m flag)
    echo -e "${YELLOW}  Downloading ZIP files...${NC}"
    gsutil cp "${INPUT_PATH}*.zip" ${TEMP_DIR}/

    ZIP_COUNT=$(ls ${TEMP_DIR}/*.zip 2>/dev/null | wc -l || echo 0)

    if [ "$ZIP_COUNT" -eq 0 ]; then
        echo -e "${RED}  ✗ No ZIP files found for ${YEAR}${NC}"
        rm -rf ${TEMP_DIR}
        continue
    fi

    echo -e "${GREEN}  ✓ Downloaded ${ZIP_COUNT} files${NC}"

    # Unzip (with progress)
    echo -e "${YELLOW}  Unzipping...${NC}"
    cd ${TEMP_DIR}
    for file in *.zip; do
        if [ -f "$file" ]; then
            echo -e "    Extracting: ${file}"
            unzip -o "$file" > /dev/null
            rm "$file"
        fi
    done

    CSV_COUNT=$(ls *.csv 2>/dev/null | wc -l || echo 0)
    echo -e "${GREEN}  ✓ Extracted ${CSV_COUNT} CSV files${NC}"

    # Upload to GCS (NO -m flag)
    echo -e "${YELLOW}  Uploading to GCS...${NC}"
    gsutil cp *.csv "${OUTPUT_PATH}"
    echo -e "${GREEN}  ✓ Uploaded to ${OUTPUT_PATH}${NC}"

    # Cleanup
    cd -
    rm -rf ${TEMP_DIR}

    echo ""
done

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}✓ Pipeline Complete!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${YELLOW}All CSV files are now available at:${NC}"
echo -e "gs://${BUCKET}/raw/historical/YEAR/csv/"
echo ""
