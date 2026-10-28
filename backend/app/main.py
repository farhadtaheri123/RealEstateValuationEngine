from __future__ import annotations

from pathlib import Path
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import csv
import io
import json
import os
import time

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, EmailStr, field_validator
from pwdlib import PasswordHash
import jwt
from jwt import InvalidTokenError

from sqlalchemy import (
    create_engine, String, Integer, Float, DateTime, ForeignKey, Text,
    select, desc
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, Session


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = PROJECT_ROOT / "models" / "trained" / "lightgbm_log_target.joblib"
CALIBRATION_PATH = PROJECT_ROOT / "models" / "evaluation" / "prediction_interval_calibration.json"
DATABASE_PATH = PROJECT_ROOT / "backend" / "valuation.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATABASE_PATH.as_posix()}")
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    # Development-only default. Set JWT_SECRET in the environment for deployment.
    JWT_SECRET = "DEV_ONLY_CHANGE_THIS_SECRET_BEFORE_DEPLOYMENT_2026"
JWT_ALGORITHM = "HS256"
TOKEN_MINUTES = 30
password_hasher = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

FEATURES = ["property_type", "old_new", "duration", "district", "sale_month"]
PROPERTY_TYPES = {"F", "T", "S", "D"}
OLD_NEW_OPTIONS = {"Y", "N"}
DURATION_OPTIONS = {"F", "L"}
DISTRICTS = {
    "BARKING AND DAGENHAM", "BARNET", "BEXLEY", "BRENT", "BROMLEY",
    "CAMDEN", "CITY OF LONDON", "CITY OF WESTMINSTER", "CROYDON",
    "EALING", "ENFIELD", "GREENWICH", "HACKNEY", "HAMMERSMITH AND FULHAM",
    "HARINGEY", "HARROW", "HAVERING", "HILLINGDON", "HOUNSLOW",
    "ISLINGTON", "KENSINGTON AND CHELSEA", "KINGSTON UPON THAMES",
    "LAMBETH", "LEWISHAM", "MERTON", "NEWHAM", "REDBRIDGE",
    "RICHMOND UPON THAMES", "SOUTHWARK", "SUTTON", "TOWER HAMLETS",
    "WALTHAM FOREST", "WANDSWORTH",
}
PROPERTY_LABELS = {"F": "Flat", "T": "Terraced house", "S": "Semi-detached house", "D": "Detached house"}
MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class SearchHistory(Base):
    __tablename__ = "search_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    property_type: Mapped[str] = mapped_column(String(1))
    old_new: Mapped[str] = mapped_column(String(1))
    duration: Mapped[str] = mapped_column(String(1))
    district: Mapped[str] = mapped_column(String(100))
    sale_month: Mapped[int] = mapped_column(Integer)
    predicted_price_gbp: Mapped[float] = mapped_column(Float)
    lower_gbp: Mapped[float] = mapped_column(Float)
    upper_gbp: Mapped[float] = mapped_column(Float)
    explanation_json: Mapped[str] = mapped_column(Text)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield

app = FastAPI(
    title="Real Estate Valuation Engine",
    description="Explainable residential property price estimation for Greater London.",
    version="1.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


if not MODEL_PATH.exists():
    raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
if not CALIBRATION_PATH.exists():
    raise FileNotFoundError(f"Calibration file not found: {CALIBRATION_PATH}")

model = joblib.load(MODEL_PATH)
with CALIBRATION_PATH.open("r", encoding="utf-8") as f:
    calibration = json.load(f)
INTERVAL_MARGIN = float(calibration["absolute_error_quantile_gbp"])
preprocessor = model.named_steps["preprocessor"]
estimator = model.named_steps["model"]
shap_explainer = shap.TreeExplainer(estimator)
TRANSFORMED_FEATURE_NAMES = preprocessor.get_feature_names_out()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password")
    @classmethod
    def password_needs_complexity(cls, value: str) -> str:
        if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
            raise ValueError("Password must contain at least one letter and one number.")
        return value

class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class PropertyInput(BaseModel):
    property_type: str
    old_new: str
    duration: str
    district: str
    sale_month: int = Field(ge=1, le=12)

class TokenOutput(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_seconds: int

def issue_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=TOKEN_MINUTES)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (InvalidTokenError, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Account not found.")
    return user

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": True, "calibration_loaded": True, "shap_loaded": True}

@app.post("/auth/register", response_model=TokenOutput, status_code=201)
def register(data: RegisterInput, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=email, password_hash=password_hasher.hash(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": issue_token(user), "expires_in_seconds": TOKEN_MINUTES * 60}

@app.post("/auth/login", response_model=TokenOutput)
def login(data: LoginInput, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not password_hasher.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return {"access_token": issue_token(user), "expires_in_seconds": TOKEN_MINUTES * 60}

@app.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "created_at": user.created_at.isoformat()}

def prepare_features(data: PropertyInput) -> pd.DataFrame:
    property_type = data.property_type.strip().upper()
    old_new = data.old_new.strip().upper()
    duration = data.duration.strip().upper()
    district = data.district.strip().upper()
    if property_type not in PROPERTY_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported property type.")
    if old_new not in OLD_NEW_OPTIONS:
        raise HTTPException(status_code=422, detail="old_new must be Y or N.")
    if duration not in DURATION_OPTIONS:
        raise HTTPException(status_code=422, detail="duration must be F or L.")
    if district not in DISTRICTS:
        raise HTTPException(status_code=422, detail="Unsupported Greater London district.")
    return pd.DataFrame([{
        "property_type": property_type, "old_new": old_new, "duration": duration,
        "district": district, "sale_month": data.sale_month,
    }], columns=FEATURES)

def describe_feature(transformed_name: str, original: pd.DataFrame) -> tuple[str, str]:
    name = str(transformed_name).split("__", 1)[-1]
    mapping = {
        "property_type": ("Property type", PROPERTY_LABELS),
        "old_new": ("Property age", {"Y": "Newly built", "N": "Existing property"}),
        "duration": ("Ownership type", {"F": "Freehold", "L": "Leasehold"}),
    }
    for feature, (label, value_map) in mapping.items():
        if name == feature or name.startswith(feature + "_"):
            value = str(original.iloc[0][feature])
            return label, value_map.get(value, value)
    if name == "district" or name.startswith("district_"):
        return "London borough", str(original.iloc[0]["district"]).title()
    if name == "sale_month":
        return "Sale month", MONTH_LABELS[int(original.iloc[0]["sale_month"]) - 1]
    return name.replace("_", " ").title(), "Model feature"

def local_explanation(features: pd.DataFrame) -> list[dict]:
    transformed = preprocessor.transform(features)
    transformed = transformed.toarray() if hasattr(transformed, "toarray") else np.asarray(transformed)
    values = np.asarray(shap_explainer.shap_values(transformed))
    if values.ndim == 3:
        values = values[0, 0, :]
    elif values.ndim == 2:
        values = values[0]
    if len(values) != len(TRANSFORMED_FEATURE_NAMES):
        raise ValueError("SHAP values do not match transformed features.")
    grouped: dict[str, dict] = {}
    for name, value in zip(TRANSFORMED_FEATURE_NAMES, values):
        label, display_value = describe_feature(name, features)
        if label not in grouped:
            grouped[label] = {"feature": label, "value": display_value, "impact_log_price": 0.0}
        grouped[label]["impact_log_price"] += float(value)
    rows = sorted(grouped.values(), key=lambda row: abs(row["impact_log_price"]), reverse=True)[:5]
    for row in rows:
        row["direction"] = "increases the prediction" if row["impact_log_price"] > 0 else "decreases the prediction" if row["impact_log_price"] < 0 else "no material directional contribution"
        row["impact_log_price"] = round(row["impact_log_price"], 6)
    return rows

@app.post("/predict")
def predict_property_price(
    data: PropertyInput,
    user: User | None = Depends(lambda: None),
):
    # Anonymous prediction is retained for public demonstration. If signed in,
    # the frontend saves it using the authenticated history endpoint below.
    features = prepare_features(data)
    start = time.perf_counter()
    try:
        log_price = float(model.predict(features)[0])
        predicted_price = float(np.exp(log_price))
        if not np.isfinite(predicted_price) or predicted_price <= 0:
            raise ValueError("Invalid predicted price.")
        explanation = local_explanation(features)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="The model could not generate the prediction and explanation.") from exc
    lower = max(0.0, predicted_price - INTERVAL_MARGIN)
    upper = predicted_price + INTERVAL_MARGIN
    elapsed_ms = (time.perf_counter() - start) * 1000
    return {
        "predicted_price_gbp": round(predicted_price, 2),
        "prediction_interval": {
            "coverage_target": float(calibration.get("coverage_level", 0.90)),
            "lower_gbp": round(lower, 2), "upper_gbp": round(upper, 2),
            "method": calibration.get("method", "split_conformal_absolute_residual"),
            "calibration_year": calibration.get("calibration_year", 2024),
        },
        "explanation": {
            "method": "SHAP TreeExplainer", "output_scale": "log_price",
            "note": "Positive contributions increase the model log-price output relative to its baseline; negative contributions decrease it. Associations are not causal effects.",
            "top_features": explanation,
        },
        "input": {
            "property_type": str(features.iloc[0]["property_type"]),
            "property_type_label": PROPERTY_LABELS[str(features.iloc[0]["property_type"])],
            "old_new": str(features.iloc[0]["old_new"]),
            "duration": str(features.iloc[0]["duration"]),
            "district": str(features.iloc[0]["district"]),
            "sale_month": int(features.iloc[0]["sale_month"]),
        },
        "currency": "GBP",
        "estimate_type": "model_estimate",
        "inference_time_ms": round(elapsed_ms, 2),
        "disclaimer": "Indicative statistical estimate only; not a formal property valuation or guaranteed sale price. The interval targets 90% marginal coverage based on 2024 calibration data; actual coverage must be checked on the held-out 2025 test set.",
    }

@app.post("/history")
def save_history(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        inp = payload["input"]
        interval = payload["prediction_interval"]
        predicted = float(payload["predicted_price_gbp"])
        low, high = float(interval["lower_gbp"]), float(interval["upper_gbp"])
        explanation = payload.get("explanation", {}).get("top_features", [])
        if not all(np.isfinite(x) for x in [predicted, low, high]) or predicted <= 0 or low < 0 or high < low:
            raise ValueError()
        row = SearchHistory(
            user_id=user.id, property_type=str(inp["property_type"]),
            old_new=str(inp["old_new"]), duration=str(inp["duration"]),
            district=str(inp["district"]), sale_month=int(inp["sale_month"]),
            predicted_price_gbp=predicted, lower_gbp=low, upper_gbp=high,
            explanation_json=json.dumps(explanation),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"id": row.id, "saved": True}
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid prediction history payload.")

@app.get("/history")
def get_history(
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 500))
    rows = db.scalars(
        select(SearchHistory).where(SearchHistory.user_id == user.id)
        .order_by(desc(SearchHistory.created_at)).limit(limit)
    ).all()
    return [{
        "id": row.id, "created_at": row.created_at.isoformat(),
        "property_type": row.property_type, "property_type_label": PROPERTY_LABELS.get(row.property_type, row.property_type),
        "old_new": row.old_new, "duration": row.duration, "district": row.district,
        "sale_month": row.sale_month, "predicted_price_gbp": row.predicted_price_gbp,
        "lower_gbp": row.lower_gbp, "upper_gbp": row.upper_gbp,
    } for row in rows]

@app.get("/history/export")
def export_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(SearchHistory).where(SearchHistory.user_id == user.id)
        .order_by(desc(SearchHistory.created_at))
    ).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["created_at", "property_type", "old_new", "duration", "district", "sale_month", "predicted_price_gbp", "lower_gbp", "upper_gbp"])
    for row in rows:
        writer.writerow([row.created_at.isoformat(), row.property_type, row.old_new, row.duration, row.district, row.sale_month, row.predicted_price_gbp, row.lower_gbp, row.upper_gbp])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="valuation_history.csv"'},
    )

@app.delete("/history/{history_id}", status_code=204)
def delete_history(
    history_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(SearchHistory).where(SearchHistory.id == history_id, SearchHistory.user_id == user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="History item not found.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
