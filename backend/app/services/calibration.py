from pathlib import Path

import joblib
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[3]

MODEL_PATH = PROJECT_ROOT / "models" / "trained" / "lightgbm_log_target.joblib"
VALIDATION_PATH = PROJECT_ROOT / "data" / "processed" / "validation_2024.csv"

FEATURES = [
    "property_type",
    "old_new",
    "duration",
    "district",
    "sale_month",
]

TARGET = "price"
COVERAGE_LEVEL = 0.90


def load_calibration_data():
    """Load the saved pipeline and the 2024 calibration dataset."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

    if not VALIDATION_PATH.exists():
        raise FileNotFoundError(
            f"Validation dataset not found: {VALIDATION_PATH}"
        )

    model = joblib.load(MODEL_PATH)
    validation = pd.read_csv(VALIDATION_PATH)

    missing = set(FEATURES + [TARGET]) - set(validation.columns)
    if missing:
        raise ValueError(
            f"Validation dataset is missing columns: {sorted(missing)}"
        )

    validation = validation.dropna(subset=FEATURES + [TARGET]).copy()
    validation[TARGET] = pd.to_numeric(
        validation[TARGET], errors="coerce"
    )
    validation = validation.dropna(subset=[TARGET])
    validation = validation[validation[TARGET] > 0]

    if validation.empty:
        raise ValueError("No valid validation records are available.")

    return model, validation


def calibrate_interval():
    """
    Calculate a split-conformal absolute residual quantile.

    The saved pipeline predicts log prices, so predictions are converted
    to GBP before residuals and prediction intervals are calculated.
    """
    model, validation = load_calibration_data()

    log_predictions = np.asarray(
        model.predict(validation[FEATURES]), dtype=float
    )
    predictions = np.exp(log_predictions)
    actual_prices = validation[TARGET].to_numpy(dtype=float)

    valid = (
        np.isfinite(predictions)
        & np.isfinite(actual_prices)
        & (predictions > 0)
        & (actual_prices > 0)
    )
    predictions = predictions[valid]
    actual_prices = actual_prices[valid]

    if len(predictions) == 0:
        raise ValueError("No valid predictions were available for calibration.")

    absolute_errors = np.abs(actual_prices - predictions)
    n = len(absolute_errors)

    # Finite-sample split-conformal quantile.
    rank = min(
        n,
        int(np.ceil((n + 1) * COVERAGE_LEVEL))
    )
    quantile = float(np.sort(absolute_errors)[rank - 1])

    return {
        "coverage_level": COVERAGE_LEVEL,
        "absolute_error_quantile_gbp": quantile,
        "calibration_samples": int(n),
        "method": "split_conformal_absolute_residual",
        "calibration_year": 2024,
    }


if __name__ == "__main__":
    calibration = calibrate_interval()

    output_path = (
        PROJECT_ROOT
        / "models"
        / "evaluation"
        / "prediction_interval_calibration.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    import json

    with output_path.open("w", encoding="utf-8") as file:
        json.dump(calibration, file, indent=2)

    print("Calibration completed.")
    print(json.dumps(calibration, indent=2))
    print(f"Saved to: {output_path}")