import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, MinMaxScaler
import os

MEDICINE_COLUMNS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

def detect_granularity(df, date_col="datum"):
    """
    Automatically detects dataset granularity based on the median time delta between consecutive sorted records.
    """
    temp_df = df.copy()
    temp_df[date_col] = pd.to_datetime(temp_df[date_col], errors='coerce')
    temp_df = temp_df.dropna(subset=[date_col]).sort_values(by=date_col)
    
    if len(temp_df) < 2:
        return "daily" # Fallback
        
    time_deltas = temp_df[date_col].diff().dropna()
    median_delta = time_deltas.median()
    
    hours = median_delta.total_seconds() / 3600.0
    
    if hours <= 3:
        return "hourly"
    elif hours <= 36:
        return "daily"
    elif hours <= 180:
        return "weekly"
    else:
        return "monthly"

def handle_missing_values(df, numeric_cols, categorical_cols):
    """
    Performs missing value treatment:
    - Numerical: Interpolate linear, fallback to median, then mean.
    - Categorical: Mode.
    """
    df_clean = df.copy()
    
    # Numerical imputation
    for col in numeric_cols:
        if col in df_clean.columns:
            # First attempt interpolation
            if df_clean[col].isnull().sum() > 0:
                df_clean[col] = df_clean[col].interpolate(method='linear')
            # Fallback to median
            if df_clean[col].isnull().sum() > 0:
                df_clean[col] = df_clean[col].fillna(df_clean[col].median())
            # Final fallback to mean
            if df_clean[col].isnull().sum() > 0:
                df_clean[col] = df_clean[col].fillna(df_clean[col].mean())
                
    # Categorical imputation
    for col in categorical_cols:
        if col in df_clean.columns:
            if df_clean[col].isnull().sum() > 0:
                mode_val = df_clean[col].mode()
                fill_val = mode_val.iloc[0] if not mode_val.empty else "Unknown"
                df_clean[col] = df_clean[col].fillna(fill_val)
                
    return df_clean

def detect_outliers(df, columns, method="both"):
    """
    Detects outliers using IQR and Z-Score methods.
    Returns a dictionary summarizing outlier indices and bounds for each column.
    """
    outliers_summary = {}
    
    for col in columns:
        if col not in df.columns:
            continue
            
        col_data = df[col].dropna()
        if len(col_data) == 0:
            continue
            
        # IQR Method
        q1 = col_data.quantile(0.25)
        q3 = col_data.quantile(0.75)
        iqr = q3 - q1
        iqr_lower = q1 - 1.5 * iqr
        iqr_upper = q3 + 1.5 * iqr
        iqr_outliers = df[(df[col] < iqr_lower) | (df[col] > iqr_upper)].index.tolist()
        
        # Z-Score Method
        mean = col_data.mean()
        std = col_data.std()
        z_outliers = []
        if std > 0:
            z_scores = (df[col] - mean) / std
            z_outliers = df[np.abs(z_scores) > 3].index.tolist()
            
        # Combine/Choose
        if method == "iqr":
            combined = iqr_outliers
        elif method == "zscore":
            combined = z_outliers
        else: # both (intersection or union)
            combined = list(set(iqr_outliers).union(set(z_outliers)))
            
        outliers_summary[col] = {
            "iqr_lower": float(iqr_lower),
            "iqr_upper": float(iqr_upper),
            "zscore_lower": float(mean - 3 * std) if std > 0 else 0.0,
            "zscore_upper": float(mean + 3 * std) if std > 0 else 0.0,
            "count": len(combined),
            "indices": combined
        }
        
    return outliers_summary

def treat_outliers(df, columns, outlier_summary, strategy="clip"):
    """
    Treats outliers by capping (clipping) to the IQR bounds or Z-Score bounds.
    """
    df_treated = df.copy()
    for col in columns:
        if col in df_treated.columns and col in outlier_summary:
            lower = outlier_summary[col]["iqr_lower"]
            upper = outlier_summary[col]["iqr_upper"]
            if strategy == "clip":
                df_treated[col] = df_treated[col].clip(lower=lower, upper=upper)
            elif strategy == "remove":
                indices = outlier_summary[col]["indices"]
                df_treated = df_treated.drop(index=indices)
    return df_treated.reset_index(drop=True)

def is_us_holiday(dt):
    """
    Check if a datetime is a standard major holiday (Jan 1, July 4, Nov late (Thanksgiving), Dec 25).
    """
    month = dt.month
    day = dt.day
    # New Year
    if month == 1 and day == 1:
        return 1
    # July 4
    if month == 7 and day == 4:
        return 1
    # Christmas
    if month == 12 and day == 25:
        return 1
    # Thanksgiving (Roughly late Nov)
    if month == 11 and dt.weekday() == 3 and day >= 22 and day <= 28:
        return 1
    return 0

def engineer_features(df, date_col="datum", granularity="daily", target_cols=MEDICINE_COLUMNS):
    """
    Performs Feature Engineering based on the temporal granularity:
    - Extracts datetime features.
    - Computes rolling windows and lag variables dynamically.
    """
    df_feat = df.copy()
    df_feat[date_col] = pd.to_datetime(df_feat[date_col])
    
    # 1. Base Datetime Features
    df_feat["Year"] = df_feat[date_col].dt.year
    df_feat["Quarter"] = df_feat[date_col].dt.quarter
    df_feat["Month"] = df_feat[date_col].dt.month
    df_feat["Day"] = df_feat[date_col].dt.day
    df_feat["Day Name"] = df_feat[date_col].dt.day_name()
    df_feat["Weekday"] = df_feat[date_col].dt.weekday
    df_feat["Weekend"] = df_feat["Weekday"].apply(lambda x: 1 if x >= 5 else 0)
    df_feat["Hour"] = df_feat[date_col].dt.hour
    df_feat["Month_Start"] = df_feat[date_col].dt.is_month_start.astype(int)
    df_feat["Month_End"] = df_feat[date_col].dt.is_month_end.astype(int)
    
    try:
        df_feat["Week"] = df_feat[date_col].dt.isocalendar().week.astype(int)
    except Exception:
        df_feat["Week"] = df_feat[date_col].dt.strftime('%U').astype(int)
        
    df_feat["Holiday"] = df_feat[date_col].apply(is_us_holiday)
    
    # 2. Seasonality Features (Sine/Cosine)
    df_feat["Month_Sin"] = np.sin(2 * np.pi * df_feat["Month"] / 12.0)
    df_feat["Month_Cos"] = np.cos(2 * np.pi * df_feat["Month"] / 12.0)
    df_feat["Day_Sin"] = np.sin(2 * np.pi * df_feat["Weekday"] / 7.0)
    df_feat["Day_Cos"] = np.cos(2 * np.pi * df_feat["Weekday"] / 7.0)
    
    # 3. Dynamic Rolling & Lag Features based on Granularity
    # Set window sizes
    if granularity == "hourly":
        rolling_windows = [24, 168] # 1 day, 1 week
        lags = [1, 2, 24, 168]
    elif granularity == "daily":
        rolling_windows = [7, 30] # 1 week, 1 month
        lags = [1, 2, 7, 30]
    elif granularity == "weekly":
        rolling_windows = [4, 12] # 1 month, 1 quarter
        lags = [1, 2, 4, 52]
    else: # monthly
        rolling_windows = [3, 6] # 1 quarter, 1 half-year
        lags = [1, 2, 3, 12]
        
    for target in target_cols:
        if target not in df_feat.columns:
            continue
            
        # Lags
        for lag in lags:
            df_feat[f"{target}_lag_{lag}"] = df_feat[target].shift(lag)
            
        # Rolling Mean and Std
        for w in rolling_windows:
            df_feat[f"{target}_roll_mean_{w}"] = df_feat[target].rolling(window=w, min_periods=1).mean()
            df_feat[f"{target}_roll_std_{w}"] = df_feat[target].rolling(window=w, min_periods=1).std().fillna(0)
            
        # Growth Rate (with lag 1)
        prev_col = f"{target}_lag_1"
        df_feat[f"{target}_growth_rate"] = (df_feat[target] - df_feat[prev_col]) / (df_feat[prev_col] + 1e-5)
        # Clip potential infs from growth rate
        df_feat[f"{target}_growth_rate"] = df_feat[f"{target}_growth_rate"].replace([np.inf, -np.inf], 0).fillna(0)
        
    # Drop rows with NaN values introduced by shift if needed, or fillna
    # Let's fill na lags with 0 or the first valid observation to avoid losing data
    lag_cols = [c for c in df_feat.columns if "_lag_" in c]
    df_feat[lag_cols] = df_feat[lag_cols].bfill().fillna(0)
    
    return df_feat

def encode_and_scale(df, categorical_cols, numeric_features, target_cols=MEDICINE_COLUMNS, scale_method="standard"):
    """
    Performs One-Hot Encoding for categorical features and Scales numerical features.
    Returns processed DataFrame, Scaler, and Encoded Feature columns.
    """
    df_proc = df.copy()
    
    # 1. One-Hot Encoding
    # Encode Weekday Name or other categoricals if present
    encoded_cols = []
    for col in categorical_cols:
        if col in df_proc.columns:
            dummies = pd.get_dummies(df_proc[col], prefix=col, drop_first=True)
            encoded_cols.extend(dummies.columns.tolist())
            df_proc = pd.concat([df_proc, dummies], axis=1)
            df_proc = df_proc.drop(columns=[col])
            
    # Convert boolean columns to int
    for col in df_proc.columns:
        if df_proc[col].dtype == bool:
            df_proc[col] = df_proc[col].astype(int)
            
    # 2. Scaling
    scaler = None
    cols_to_scale = [c for c in numeric_features if c in df_proc.columns and c not in target_cols]
    
    if len(cols_to_scale) > 0:
        if scale_method == "standard":
            scaler = StandardScaler()
        elif scale_method == "minmax":
            scaler = MinMaxScaler()
            
        if scaler is not None:
            df_proc[cols_to_scale] = scaler.fit_transform(df_proc[cols_to_scale].astype(float))
            
    return df_proc, scaler, encoded_cols

def preprocess_pipeline(csv_path, scale_method="standard"):
    """
    Complete wrapper that loads, cleans, detects granularity, outlier-filters, scales, and prepares the dataset.
    """
    df = pd.read_csv(csv_path)
    
    # 1. Sort and Format Date
    date_col = "datum"
    if date_col not in df.columns:
        # Try to find a date column
        for c in df.columns:
            if "date" in c.lower() or "time" in c.lower() or "datum" in c.lower():
                date_col = c
                break
    
    df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
    df = df.dropna(subset=[date_col]).sort_values(by=date_col).reset_index(drop=True)
    
    # Detect granularity
    granularity = detect_granularity(df, date_col)
    
    # 2. Numerical and Categorical column recognition
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    if date_col in categorical_cols:
        categorical_cols.remove(date_col)
    if "Weekday Name" in categorical_cols:
        # Keep Weekday Name for encoding
        pass
        
    # 3. Missing Value treatment
    df = handle_missing_values(df, numeric_cols, categorical_cols)
    
    # 4. Outlier detection and capping for Target Medicine classes
    targets = [c for c in MEDICINE_COLUMNS if c in df.columns]
    outlier_summary = detect_outliers(df, targets, method="both")
    df = treat_treated = treat_outliers(df, targets, outlier_summary, strategy="clip")
    
    # 5. Feature Engineering
    df_feat = engineer_features(df, date_col=date_col, granularity=granularity, target_cols=targets)
    
    # 6. Scaling & Encoding
    # Numeric features to scale (lag features, rolling features, sin/cos features)
    features_to_scale = [c for c in df_feat.columns if any(x in c for x in ["_lag_", "_roll_", "_Sin", "_Cos", "Year", "Quarter", "Month", "Week", "Day", "Hour"])]
    
    # Categorical columns to encode (like 'Weekday Name')
    cats_to_encode = [c for c in ["Weekday Name", "Day Name"] if c in df_feat.columns]
    
    df_final, scaler, encoded_cols = encode_and_scale(
        df_feat, 
        cats_to_encode, 
        features_to_scale, 
        target_cols=targets, 
        scale_method=scale_method
    )
    
    return {
        "df": df_final,
        "raw_df": df,
        "granularity": granularity,
        "targets": targets,
        "scaler": scaler,
        "outlier_summary": outlier_summary,
        "date_col": date_col
    }
