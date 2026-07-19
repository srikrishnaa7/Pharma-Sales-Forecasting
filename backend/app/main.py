import sys
import os
from datetime import datetime
from dotenv import load_dotenv

# Add workspace directory to python path for backend resolution
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Load environment variables
load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")

from fastapi import FastAPI, HTTPException, status, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import shutil
from typing import List, Dict, Any, Optional

from backend.app.services.preprocessing import preprocess_pipeline, MEDICINE_COLUMNS
from backend.app.services.forecasting import ForecastEngine, save_model, load_model
from backend.app.services.insights import generate_chatbot_response

# FastAPI Application
app = FastAPI(
    title="AI-Powered Pharma Sales Forecasting API",
    description="Backend API for Preprocessing, Hybrid Forecasting, and Contextual AI Chat",
    version="2.0.0"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State / Cache
DATA_CACHE = {
    "hourly": {"preprocessed_data": None, "trained_engines": {}},
    "daily": {"preprocessed_data": None, "trained_engines": {}},
    "weekly": {"preprocessed_data": None, "trained_engines": {}},
    "monthly": {"preprocessed_data": None, "trained_engines": {}},
    "is_training": False,
    "training_progress": "Idle"
}

# Chat Memory
CHAT_HISTORY = []

# Pydantic Schemas
class PredictRequest(BaseModel):
    category: str
    features: Dict[str, float]

class ChatRequest(BaseModel):
    message: str
    product: str
    horizon: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    granularity: Optional[str] = "daily"

class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: str

class SelectDatasetRequest(BaseModel):
    filename: str

# Background Training Task
def train_all_models_task():
    global DATA_CACHE
    DATA_CACHE["is_training"] = True
    
    granularities = ["monthly", "weekly", "daily", "hourly"]
    
    for gran in granularities:
        DATA_CACHE["training_progress"] = f"Preprocessing {gran} dataset..."
        csv_path = os.path.join(DATA_DIR, f"sales{gran}.csv")
        try:
            res = preprocess_pipeline(csv_path)
            DATA_CACHE[gran]["preprocessed_data"] = res
            
            df = res["df"]
            targets = res["targets"]
            
            # Train/Load engine for each target
            for idx, target in enumerate(targets):
                DATA_CACHE["training_progress"] = f"Training {gran} models: {target} ({idx+1}/{len(targets)})..."
                
                # Check if model exists on disk
                model_name = f"{gran}_{target}"
                engine = load_model(model_name, base_path="backend/models/")
                if engine is None:
                    engine = ForecastEngine(target_col=target)
                    engine.evaluate_models(df, gran, test_ratio=0.2)
                    save_model(engine, model_name, base_path="backend/models/")
                
                DATA_CACHE[gran]["trained_engines"][target] = engine
        except Exception as e:
            print(f"Error in background training for {gran}: {str(e)}")
            DATA_CACHE["training_progress"] = f"Training failed for {gran}: {str(e)}"
            
    DATA_CACHE["training_progress"] = "All models trained successfully."
    DATA_CACHE["is_training"] = False

# Startup Event
@app.on_event("startup")
def startup_event():
    # Run model loading/training in background so API starts instantly
    import threading
    thread = threading.Thread(target=train_all_models_task)
    thread.start()

# --- API Routes ---

@app.get("/api/status")
def get_status(granularity: str = "daily"):
    last_date = "2019-10-09"  # Fallback standard
    if granularity in DATA_CACHE and DATA_CACHE[granularity]["preprocessed_data"] is not None:
        try:
            raw_df = DATA_CACHE[granularity]["preprocessed_data"]["raw_df"]
            date_col = DATA_CACHE[granularity]["preprocessed_data"]["date_col"]
            last_date = pd.to_datetime(raw_df[date_col].iloc[-1]).strftime('%Y-%m-%d')
        except Exception:
            pass
            
    return {
        "is_training": DATA_CACHE["is_training"],
        "progress": DATA_CACHE["training_progress"],
        "active_dataset": f"sales{granularity}.csv",
        "last_historical_date": last_date,
        "granularity": granularity
    }

@app.get("/api/datasets")
def get_datasets():
    """
    Returns the list of 4 available datasets in the data folder.
    """
    return ["salesdaily.csv", "salesweekly.csv", "salesmonthly.csv", "saleshourly.csv"]

@app.get("/api/products")
def get_products(granularity: str = "daily"):
    """
    Returns list of medicine categories with simple metrics.
    """
    if granularity not in DATA_CACHE or DATA_CACHE[granularity]["preprocessed_data"] is None:
        return []
        
    raw_df = DATA_CACHE[granularity]["preprocessed_data"]["raw_df"]
    targets = DATA_CACHE[granularity]["preprocessed_data"]["targets"]
    
    product_details = {
        "M01AB": "Anti-inflammatory/Antirheumatic (Acetic acid derivatives)",
        "M01AE": "Anti-inflammatory/Antirheumatic (Propionic acid derivatives - e.g. Ibuprofen)",
        "N02BA": "Salicylic acid derivatives (Analgesics)",
        "N02BE": "Anilides (Analgesics/Antipyretics - e.g. Paracetamol)",
        "N05B": "Anxiolytic psycholeptics",
        "N05C": "Hypnotics and sedatives",
        "R03": "Obstructive airway diseases drugs (Asthma)",
        "R06": "Systemic antihistamines"
    }
    
    products_list = []
    for t in targets:
        col_data = raw_df[t]
        engine = DATA_CACHE[granularity]["trained_engines"].get(t)
        
        products_list.append({
            "code": t,
            "name": product_details.get(t, "Unknown Class"),
            "total_sold": float(col_data.sum()),
            "daily_avg": float(col_data.mean()),
            "max_sold": float(col_data.max()),
            "std_dev": float(col_data.std()),
            "model_r2": float(engine.metrics["hybrid"]["r2"]) if engine and "hybrid" in engine.metrics else 0.0
        })
        
    return products_list

@app.get("/api/sales-history")
def get_sales_history(granularity: str = "daily"):
    """
    Returns full cleaned sales historical data for Recharts charting.
    """
    if granularity not in DATA_CACHE or DATA_CACHE[granularity]["preprocessed_data"] is None:
        return []
        
    raw_df = DATA_CACHE[granularity]["preprocessed_data"]["raw_df"]
    targets = DATA_CACHE[granularity]["preprocessed_data"]["targets"]
    date_col = DATA_CACHE[granularity]["preprocessed_data"]["date_col"]
    
    # Select date and all product columns
    cols_to_select = [date_col] + targets
    df_sales = raw_df[cols_to_select].copy()
    
    # Format date string
    df_sales[date_col] = df_sales[date_col].dt.strftime('%Y-%m-%d %H:%M:%S')
    
    return df_sales.to_dict(orient="records")

@app.get("/api/forecast")
def get_forecast(
    category: str, 
    horizon: Optional[int] = None,
    start_date: Optional[str] = None, 
    end_date: Optional[str] = None, 
    granularity: str = "daily"
):
    """
    Returns predictions from Prophet, Random Forest, and the Hybrid model,
    including confidence intervals, historical baseline, and summary statistics.
    """
    if granularity not in DATA_CACHE or DATA_CACHE[granularity]["preprocessed_data"] is None:
        raise HTTPException(status_code=503, detail="Model training in progress. Try again soon.")
        
    df_processed = DATA_CACHE[granularity]["preprocessed_data"]["df"]
    raw_df = DATA_CACHE[granularity]["preprocessed_data"]["raw_df"]
    date_col = DATA_CACHE[granularity]["preprocessed_data"]["date_col"]
    engine = DATA_CACHE[granularity]["trained_engines"].get(category)
    
    if engine is None:
        raise HTTPException(status_code=404, detail=f"No trained model found for category {category}")
        
    # Get last historical date
    last_historical_date_dt = pd.to_datetime(raw_df[date_col].iloc[-1])
    last_historical_date_str = last_historical_date_dt.strftime('%Y-%m-%d')
    
    # Convert dates or compute based on horizon
    if horizon is not None and not start_date and not end_date:
        if granularity == "hourly":
            end_date_dt = last_historical_date_dt + pd.Timedelta(hours=horizon)
            start_date_dt = last_historical_date_dt + pd.Timedelta(hours=1)
        elif granularity == "weekly":
            end_date_dt = last_historical_date_dt + pd.Timedelta(weeks=horizon)
            start_date_dt = last_historical_date_dt + pd.Timedelta(weeks=1)
        elif granularity == "monthly":
            end_date_dt = last_historical_date_dt + pd.offsets.DateOffset(months=horizon)
            start_date_dt = last_historical_date_dt + pd.offsets.DateOffset(months=1)
        else: # daily
            end_date_dt = last_historical_date_dt + pd.Timedelta(days=horizon)
            start_date_dt = last_historical_date_dt + pd.Timedelta(days=1)
            
        start_date = start_date_dt.strftime('%Y-%m-%d')
        end_date = end_date_dt.strftime('%Y-%m-%d')
    else:
        if not start_date:
            start_date_dt = last_historical_date_dt + pd.Timedelta(days=1)
            start_date = start_date_dt.strftime('%Y-%m-%d')
        else:
            start_date_dt = pd.to_datetime(start_date)
            
        if not end_date:
            end_date_dt = last_historical_date_dt + pd.Timedelta(days=90)
            end_date = end_date_dt.strftime('%Y-%m-%d')
        else:
            end_date_dt = pd.to_datetime(end_date)
            
    # Validations
    if start_date_dt <= last_historical_date_dt:
         raise HTTPException(
             status_code=400, 
             detail=f"Start date ({start_date}) must be after the last historical date ({last_historical_date_str})"
         )
         
    if end_date_dt <= start_date_dt:
         raise HTTPException(
             status_code=400, 
             detail=f"End date ({end_date}) must be after start date ({start_date})"
         )
         
    # Calculate horizon steps from last historical date to end_date
    diff_days = (end_date_dt - last_historical_date_dt).days
    if granularity == "hourly":
        horizon_steps = max(1, diff_days * 24)
    elif granularity == "weekly":
        horizon_steps = max(1, int(np.ceil(diff_days / 7.0)))
    elif granularity == "monthly":
        horizon_steps = max(1, int(np.ceil(diff_days / 30.5)))
    else: # daily
        horizon_steps = max(1, diff_days)
        
    # Generate future predictions
    forecast = engine.generate_future_forecast(df_processed, horizon_steps, granularity)
    f_dates = [pd.to_datetime(d) for d in forecast["dates"]]
    
    # Filter forecast records to requested start_date -> end_date window
    forecast_records = []
    for idx, d_dt in enumerate(f_dates):
        d_str = d_dt.strftime('%Y-%m-%d')
        if start_date_dt <= d_dt <= end_date_dt:
            forecast_records.append({
                "date": d_str,
                "prediction": float(forecast["hybrid"][idx]),
                "prophet": float(forecast["prophet"][idx]),
                "random_forest": float(forecast["random_forest"][idx]),
                "lower_bound": float(forecast["lower_bound"][idx]),
                "upper_bound": float(forecast["upper_bound"][idx])
            })
            
    # Calculate summary statistics over the selected date range
    if forecast_records:
        preds = [r["prediction"] for r in forecast_records]
        sum_stats = {
            "total_predicted_sales": float(np.sum(preds)),
            "average_predicted_sales": float(np.mean(preds)),
            "highest_predicted_sales": float(np.max(preds)),
            "lowest_predicted_sales": float(np.min(preds))
        }
    else:
        sum_stats = {
            "total_predicted_sales": 0.0,
            "average_predicted_sales": 0.0,
            "highest_predicted_sales": 0.0,
            "lowest_predicted_sales": 0.0
        }
        
    # Format historical records (last 90 records for charting baseline)
    hist_records = []
    hist_slice = raw_df.tail(90) if granularity in ["daily", "hourly"] else raw_df.tail(45)
    for idx, row in hist_slice.iterrows():
        d_str = pd.to_datetime(row[date_col]).strftime('%Y-%m-%d')
        hist_records.append({
            "date": d_str,
            "sales": float(row[category])
        })
        
    # Ensure validation comparison is present (dynamic fallback)
    validation_comp = getattr(engine, "validation_comparison", None)
    if not validation_comp:
        try:
            engine.evaluate_models(df_processed, granularity)
            save_model(engine, f"{granularity}_{category}", base_path="backend/models/")
            validation_comp = getattr(engine, "validation_comparison", None)
        except Exception as e:
            print(f"Error evaluating validation on the fly: {str(e)}")
            
    val_comp_res = {
        "dates": [],
        "actual": [],
        "hybrid": []
    }
    if validation_comp:
        val_comp_res = {
            "dates": validation_comp.get("dates", []),
            "actual": validation_comp.get("actual", []),
            "hybrid": validation_comp.get("hybrid", [])
        }
        
    full_fc = {
        "dates": [pd.to_datetime(d).strftime('%Y-%m-%d') for d in forecast["dates"]],
        "hybrid": forecast["hybrid"],
        "prophet": forecast["prophet"],
        "random_forest": forecast["random_forest"],
        "lower_bound": forecast["lower_bound"],
        "upper_bound": forecast["upper_bound"]
    }
        
    return {
        "category": category,
        "granularity": granularity,
        "date_range": {
            "start_date": start_date,
            "end_date": end_date
        },
        "last_historical_date": last_historical_date_str,
        "summary_statistics": sum_stats,
        "historical_data": hist_records,
        "forecast_data": forecast_records,
        "validation_comparison": val_comp_res,
        "future_forecast": full_fc,
        "full_forecast": full_fc
    }

@app.get("/api/chat/history")
def get_chat_history():
    return CHAT_HISTORY

@app.post("/api/chat/clear")
def clear_chat_history():
    global CHAT_HISTORY
    CHAT_HISTORY = []
    return {"status": "Chat history cleared"}

@app.post("/api/predict")
def predict_single(req: PredictRequest, granularity: str = "daily"):
    """
    Accepts customized features dynamically and returns Random Forest prediction.
    """
    if granularity not in DATA_CACHE or DATA_CACHE[granularity]["preprocessed_data"] is None:
        raise HTTPException(status_code=503, detail="Models not trained.")
    engine = DATA_CACHE[granularity]["trained_engines"].get(req.category)
    if engine is None or engine.rf_model is None:
        raise HTTPException(status_code=404, detail=f"No RF model trained for {req.category}")
        
    feat_vector = []
    for feat in engine.features:
        feat_vector.append(req.features.get(feat, 0.0))
        
    X_pred = pd.DataFrame([feat_vector], columns=engine.features)
    pred_val = float(engine.rf_model.predict(X_pred)[0])
    
    return {
        "category": req.category,
        "prediction": round(max(0.0, pred_val), 4)
    }

@app.post("/api/chat")
async def chat_with_insights(req: ChatRequest):
    """
    Accepts a user query, generates a data-grounded strategic context,
    queries Gemini, and records details in session memory.
    """
    gran = req.granularity or "daily"
    if gran not in DATA_CACHE or DATA_CACHE[gran]["preprocessed_data"] is None:
        raise HTTPException(status_code=503, detail="Database pre-training in progress. Chatbot is offline.")
        
    raw_df = DATA_CACHE[gran]["preprocessed_data"]["raw_df"]
    df_processed = DATA_CACHE[gran]["preprocessed_data"]["df"]
    date_col = DATA_CACHE[gran]["preprocessed_data"]["date_col"]
    
    engine = DATA_CACHE[gran]["trained_engines"].get(req.product)
    if engine is None:
        raise HTTPException(status_code=404, detail=f"No engine found for product {req.product}")
        
    # Get last historical date
    last_historical_date_dt = pd.to_datetime(raw_df[date_col].iloc[-1])
    
    # Resolve dates
    start_date_str = req.start_date
    end_date_str = req.end_date
    
    if start_date_str:
        start_date_dt = pd.to_datetime(start_date_str)
    else:
        start_date_dt = last_historical_date_dt + pd.Timedelta(days=1)
        start_date_str = start_date_dt.strftime('%Y-%m-%d')
        
    if end_date_str:
        end_date_dt = pd.to_datetime(end_date_str)
    else:
        if req.horizon:
            if gran == "hourly":
                end_date_dt = last_historical_date_dt + pd.Timedelta(hours=req.horizon)
            elif gran == "weekly":
                end_date_dt = last_historical_date_dt + pd.Timedelta(weeks=req.horizon)
            elif gran == "monthly":
                end_date_dt = last_historical_date_dt + pd.offsets.DateOffset(months=req.horizon)
            else:
                end_date_dt = last_historical_date_dt + pd.Timedelta(days=req.horizon)
        else:
            end_date_dt = last_historical_date_dt + pd.Timedelta(days=90)
        end_date_str = end_date_dt.strftime('%Y-%m-%d')
        
    # Calculate horizon steps
    diff_days = (end_date_dt - last_historical_date_dt).days
    if gran == "hourly":
        horizon_steps = max(1, diff_days * 24)
    elif gran == "weekly":
        horizon_steps = max(1, int(np.ceil(diff_days / 7.0)))
    elif gran == "monthly":
        horizon_steps = max(1, int(np.ceil(diff_days / 30.5)))
    else: # daily
        horizon_steps = max(1, diff_days)
        
    # Fetch forecast context
    forecast = engine.generate_future_forecast(df_processed, horizon_steps, gran)
    
    # Format current chat history
    formatted_history = [
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in CHAT_HISTORY
    ]
    
    # Call chatbot response generator
    ai_response = generate_chatbot_response(
        user_message=req.message,
        active_product=req.product,
        horizon_days=(end_date_dt - start_date_dt).days,
        chat_history=formatted_history,
        historical_df=raw_df,
        forecast_dict=forecast,
        start_date=start_date_str,
        end_date=end_date_str,
        granularity=gran
    )
    
    # Save messages to history
    timestamp = datetime.now().strftime('%H:%M')
    CHAT_HISTORY.append({"role": "user", "content": req.message, "timestamp": timestamp})
    CHAT_HISTORY.append({"role": "assistant", "content": ai_response, "timestamp": timestamp})
    
    return {
        "response": ai_response,
        "history": CHAT_HISTORY
    }

@app.post("/api/upload")
async def upload_csv(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """
    Saves uploaded file and schedules a model re-training thread in the background.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")
        
    upload_dir = "backend/data/uploads"
    os.makedirs(upload_dir, exist_ok=True)
    
    filepath = os.path.join(upload_dir, file.filename)
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Update current file and schedule training
    DATA_CACHE["current_file"] = filepath
    background_tasks.add_task(train_all_models_task)
    
    # Clear chat history for the new dataset
    global CHAT_HISTORY
    CHAT_HISTORY = []
    
    return {
        "status": "File uploaded successfully. Retraining model pipeline.",
        "filename": file.filename
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
