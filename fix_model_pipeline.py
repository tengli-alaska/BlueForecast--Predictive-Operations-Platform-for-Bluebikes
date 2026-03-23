#!/usr/bin/env python3
"""
Auto-fix script for BlueForecast Model Pipeline improvements.
Fixes: sample_weight support + station ID encoding bug
"""

import os
import re
import sys

def main():
    # Check if we're in the right directory
    if not os.path.exists("Model-Pipeline"):
        print("❌ Error: Run this script from the BlueForecast repo root directory")
        print("Expected to find: Model-Pipeline/")
        sys.exit(1)
    
    print("🔧 BlueForecast Model Pipeline Auto-Fixer")
    print("=" * 60)
    
    # Fix 1: trainer.py - Add sample_weight support
    fix_trainer_py()
    
    # Fix 2: data_loader.py - Use LabelEncoder consistently
    fix_data_loader_py()
    
    # Fix 3: predictor.py - Load saved LabelEncoder
    fix_predictor_py()
    
    # Fix 4: model_tasks.py - Handle 3-value return from load_feature_matrix
    fix_model_tasks_py()
    
    print("\n✅ All fixes applied successfully!")
    print("\nNext steps:")
    print("  1. Review changes: git diff")
    print("  2. Commit: git add -A && git commit -m 'fix: add sample_weight + fix station ID encoding'")
    print("  3. Push: git push origin model-pipeline-improvements-vraj")

def fix_trainer_py():
    file_path = "Model-Pipeline/src/model_pipeline/trainer.py"
    print(f"\n📝 Fixing {file_path}...")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Fix 1: Add sample_weight to BaseForecaster.train() abstract method (line ~60)
    content = re.sub(
        r'(@abstractmethod\s+def train\(\s+self,\s+X_train: np\.ndarray,\s+y_train: np\.ndarray,\s+X_val: np\.ndarray,\s+y_val: np\.ndarray,\s+params: dict\[str, Any\],\s+\) -> "BaseForecaster":)',
        r'@abstractmethod\n    def train(\n        self,\n        X_train: np.ndarray,\n        y_train: np.ndarray,\n        X_val: np.ndarray,\n        y_val: np.ndarray,\n        params: dict[str, Any],\n        sample_weight: np.ndarray | None = None,\n    ) -> "BaseForecaster":',
        content,
        flags=re.DOTALL,
        count=1
    )
    
    # Fix 2: Add sample_weight to XGBoostForecaster.train() signature (line ~95)
    content = re.sub(
        r'(def train\(\s+self,\s+X_train: np\.ndarray,\s+y_train: np\.ndarray,\s+X_val: np\.ndarray,\s+y_val: np\.ndarray,\s+params: dict\[str, Any\],\s+\) -> "XGBoostForecaster":)',
        r'def train(\n        self,\n        X_train: np.ndarray,\n        y_train: np.ndarray,\n        X_val: np.ndarray,\n        y_val: np.ndarray,\n        params: dict[str, Any],\n        sample_weight: np.ndarray | None = None,\n    ) -> "XGBoostForecaster":',
        content,
        count=1
    )
    
    # Fix 3: Add sample_weight to .fit() call
    content = re.sub(
        r'(self\._model\.fit\(\s+X_train,\s+y_train,\s+eval_set=)',
        r'self._model.fit(\n            X_train,\n            y_train,\n            sample_weight=sample_weight,\n            eval_set=',
        content,
        count=1
    )
    
    # Fix 4: Add sample_weight to run_training_pipeline() signature
    content = re.sub(
        r'(def run_training_pipeline\([^)]+forecaster_class: type\[BaseForecaster\] = XGBoostForecaster,)\s*\)\s*->',
        r'\1\n    sample_weight: np.ndarray | None = None,\n) ->',
        content,
        flags=re.DOTALL,
        count=1
    )
    
    # Fix 5: Pass sample_weight to forecaster.train()
    content = re.sub(
        r'forecaster\.train\(X_train_arr, y_train_arr, X_val_arr, y_val_arr, params\)',
        r'forecaster.train(X_train_arr, y_train_arr, X_val_arr, y_val_arr, params, sample_weight=sample_weight)',
        content,
        count=1
    )
    
    # Fix 6: Add bias_mitigation_applied tag
    content = re.sub(
        r'("status": "pending",)\s*}\)',
        r'"status": "pending",\n            "bias_mitigation_applied": "true" if sample_weight is not None else "false",\n        })',
        content,
        count=1
    )
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"  ✓ Added sample_weight support")

def fix_data_loader_py():
    file_path = "Model-Pipeline/src/model_pipeline/data_loader.py"
    print(f"\n📝 Fixing {file_path}...")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Add imports
    if 'from sklearn.preprocessing import LabelEncoder' not in content:
        content = re.sub(
            r'(import pandas as pd)',
            r'import pandas as pd\nfrom sklearn.preprocessing import LabelEncoder',
            content,
            count=1
        )
    
    if 'import pickle' not in content:
        content = re.sub(
            r'(import logging)',
            r'import logging\nimport pickle',
            content,
            count=1
        )
    
    # Replace encoding block
    content = re.sub(
        r'if "start_station_id" in df\.columns:\s+df\["start_station_id"\] = df\["start_station_id"\]\.astype\("category"\)\.cat\.codes\s+logger\.info\("Encoded start_station_id: %s unique stations", df\["start_station_id"\]\.nunique\(\)\)',
        '''if "start_station_id" in df.columns:
        le = LabelEncoder()
        df["start_station_id"] = le.fit_transform(df["start_station_id"].astype(str))
        logger.info("Encoded start_station_id: %s unique stations", df["start_station_id"].nunique())
        
        # Save encoder to GCS
        le_bytes = pickle.dumps(le)
        enc_blob = client.bucket(BUCKET).blob("processed/features/station_label_encoder.pkl")
        enc_blob.upload_from_string(le_bytes)
        logger.info("LabelEncoder saved to GCS")''',
        content,
        flags=re.DOTALL
    )
    
    # Update return
    content = re.sub(
        r'return df, dataset_version_hash$',
        r'return df, dataset_version_hash, le',
        content,
        flags=re.MULTILINE
    )
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"  ✓ Switched to LabelEncoder with GCS save")

def fix_predictor_py():
    file_path = "Model-Pipeline/src/model_pipeline/predictor.py"
    print(f"\n�� Fixing {file_path}...")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    if 'import pickle' not in content:
        content = re.sub(
            r'(import io)',
            r'import io\nimport pickle',
            content,
            count=1
        )
    
    # Replace LabelEncoder fit with load from GCS
    content = re.sub(
        r'le = LabelEncoder\(\)\s+le\.fit\(df\["start_station_id"\]\)\s+logger\.info\("LabelEncoder fit on %d station IDs", len\(le\.classes_\)\)',
        '''enc_blob = storage.Client().bucket(BUCKET).blob("processed/features/station_label_encoder.pkl")
    le = pickle.loads(enc_blob.download_as_bytes())
    logger.info("LabelEncoder loaded from GCS: %d station IDs", len(le.classes_))''',
        content,
        flags=re.DOTALL
    )
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"  ✓ Load LabelEncoder from GCS")

def fix_model_tasks_py():
    file_path = "Model-Pipeline/src/model_tasks.py"
    print(f"\n📝 Fixing {file_path}...")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Update all load_feature_matrix() calls
    content = re.sub(
        r'df, _ = load_feature_matrix\(\)',
        r'df, _, _le = load_feature_matrix()',
        content
    )
    
    content = re.sub(
        r'df, dataset_hash = load_feature_matrix\(\)',
        r'df, dataset_hash, _le = load_feature_matrix()',
        content
    )
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"  ✓ Updated load_feature_matrix() calls")

if __name__ == "__main__":
    main()
