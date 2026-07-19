import traceback
from fastapi.openapi import models
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from prophet import Prophet
import os
import joblib
from backend.app.services.preprocessing import is_us_holiday

MEDICINE_COLUMNS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

def calculate_mape(y_true, y_pred):
    """
    Computes Mean Absolute Percentage Error. Handles zeros gracefully.
    """
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    mask = y_true != 0
    if not np.any(mask):
        return 0.0
    return np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100

def get_forecast_steps(granularity, days):
    """
    Translates forecasting days to steps based on granularity.
    """
    if granularity == "hourly":
        return days * 24
    elif granularity == "daily":
        return days
    elif granularity == "weekly":
        return int(np.ceil(days / 7.0))
    elif granularity == "monthly":
        return int(np.ceil(days / 30.0))
    return days

class ForecastEngine:
    def __init__(self, target_col, date_col="datum"):
        self.target_col = target_col
        self.date_col = date_col
        self.prophet_model = None
        self.rf_model = None
        self.features = []
        self.scaler = None
        self.metrics = {}
        
    def prepare_data(self, df_processed):
        """
        Identify features and targets for Random Forest.
        """
        # Exclude other targets, datetime raw columns, and the date column
        exclude_cols = [self.date_col, "Day Name", "Weekday Name"] + MEDICINE_COLUMNS
        
        # Features should be lag, rolling, datetime components, and sin/cos encodings
        # Specific to this target
        self.features = [c for c in df_processed.columns if 
                         c not in exclude_cols and 
                         (not any(t in c for t in MEDICINE_COLUMNS) or self.target_col in c)]
        
        X = df_processed[self.features]
        y = df_processed[self.target_col]
        return X, y

    def train_test_split(self, df_processed, test_ratio=0.2):
        """
        Perform a chronological train-test split for time-series validation.
        """
        split_idx = int(len(df_processed) * (1 - test_ratio))
        train_df = df_processed.iloc[:split_idx].reset_index(drop=True)
        val_df = df_processed.iloc[split_idx:].reset_index(drop=True)
        return train_df, val_df

    def train_prophet(self, train_df, val_df, granularity):
        """
        Trains Facebook Prophet on training split and predicts on validation split.
        """
        # Prophet requires columns: ds and y
        prophet_train = pd.DataFrame({
            'ds': pd.to_datetime(train_df[self.date_col]),
            'y': train_df[self.target_col]
        })
        
        # Initialize Prophet with granularity-tuned seasonalities
        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True if granularity in ["hourly", "daily", "weekly"] else False,
            daily_seasonality=True if granularity == "hourly" else False,
            interval_width=0.95
        )
        
        import traceback

        try:
            model.fit(prophet_train)
        except Exception as e:
            print("\n========== PROPHET TRAIN ERROR ==========")
            traceback.print_exc()
            print("=========================================\n")
            raise

        self.prophet_model = model
        
        # Predict on validation
        future_val = pd.DataFrame({'ds': pd.to_datetime(val_df[self.date_col])})
        forecast = model.predict(future_val)
        return forecast['yhat'].values, forecast[['yhat_lower', 'yhat_upper']].values

    def train_random_forest(self, train_df, val_df):
        """
        Trains a Random Forest Regressor on features.
        """
        X_train, y_train = self.prepare_data(train_df)
        X_val, y_val = self.prepare_data(val_df)
        
        # Choose robust hyper-parameters for forecasting
        model = RandomForestRegressor(
            n_estimators=150,
            max_depth=10,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1
        )
        model.fit(X_train, y_train)
        self.rf_model = model
        
        # Predict on validation
        preds = model.predict(X_val)
        return preds

    def evaluate_models(self, df_processed, granularity, test_ratio=0.2):
        """
        Trains and evaluates Prophet, Random Forest, and the Hybrid model on the validation split.
        """
        train_df, val_df = self.train_test_split(df_processed, test_ratio)
        
        # Actual validation target
        y_val = val_df[self.target_col].values
        
        # 1. Train & Predict Prophet
        prophet_preds, prophet_intervals = self.train_prophet(train_df, val_df, granularity)
        # Handle negative predictions (sales cannot be negative)
        prophet_preds = np.clip(prophet_preds, 0, None)
        
        # 2. Train & Predict RF
        rf_preds = self.train_random_forest(train_df, val_df)
        rf_preds = np.clip(rf_preds, 0, None)
        
        # 3. Dynamic Hybrid weights based on MAE validation performance
        mae_p = mean_absolute_error(y_val, prophet_preds)
        mae_rf = mean_absolute_error(y_val, rf_preds)
        
        # Compute inverse MAE weights: better model gets higher weight
        if mae_p + mae_rf > 0:
            w_rf = mae_p / (mae_p + mae_rf)
            w_p = mae_rf / (mae_p + mae_rf)
        else:
            w_rf, w_p = 0.5, 0.5
            
        # Limit weight range to [0.2, 0.8] to prevent over-reliance on one model
        w_rf = np.clip(w_rf, 0.2, 0.8)
        w_p = 1.0 - w_rf
        
        # 4. Hybrid predictions
        hybrid_preds = w_p * prophet_preds + w_rf * rf_preds
        
        # 5. Evaluate Metrics
        self.metrics = {
            "prophet": {
                "mae": float(mean_absolute_error(y_val, prophet_preds)),
                "rmse": float(np.sqrt(mean_squared_error(y_val, prophet_preds))),
                "mape": float(calculate_mape(y_val, prophet_preds)),
                "r2": float(r2_score(y_val, prophet_preds))
            },
            "random_forest": {
                "mae": float(mean_absolute_error(y_val, rf_preds)),
                "rmse": float(np.sqrt(mean_squared_error(y_val, rf_preds))),
                "mape": float(calculate_mape(y_val, rf_preds)),
                "r2": float(r2_score(y_val, rf_preds))
            },
            "hybrid": {
                "mae": float(mean_absolute_error(y_val, hybrid_preds)),
                "rmse": float(np.sqrt(mean_squared_error(y_val, hybrid_preds))),
                "mape": float(calculate_mape(y_val, hybrid_preds)),
                "r2": float(r2_score(y_val, hybrid_preds)),
                "weights": {"prophet": float(w_p), "random_forest": float(w_rf)}
            }
        }
        
        # 6. Fit models on full dataset for final future forecasting
        self.prophet_model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True if granularity in ["hourly", "daily", "weekly"] else False,
            daily_seasonality=True if granularity == "hourly" else False,
            interval_width=0.95
        )
        prophet_full_df = pd.DataFrame({
            'ds': pd.to_datetime(df_processed[self.date_col]),
            'y': df_processed[self.target_col]
        })
        try:
            self.prophet_model.fit(prophet_full_df)
        except Exception as e:
            print("\n========== PROPHET FULL TRAIN ERROR ==========")
            traceback.print_exc()
            print("==============================================\n")
            raise
        
        X_full, y_full = self.prepare_data(df_processed)
        self.rf_model = RandomForestRegressor(
            n_estimators=150,
            max_depth=10,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1
        )
        self.rf_model.fit(X_full, y_full)
        
        self.validation_comparison = {
            "dates": [pd.to_datetime(d).strftime('%Y-%m-%d') for d in val_df[self.date_col]],
            "actual": y_val.tolist(),
            "hybrid": hybrid_preds.tolist()
        }
        
        return {
            "metrics": self.metrics,
            "val_actual": y_val.tolist(),
            "val_prophet": prophet_preds.tolist(),
            "val_rf": rf_preds.tolist(),
            "val_hybrid": hybrid_preds.tolist(),
            "val_dates": val_df[self.date_col].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
        }
        
    def get_feature_importances(self):
        """
        Returns feature importances for the Random Forest model.
        """
        if self.rf_model is None or len(self.features) == 0:
            return []
            
        importances = self.rf_model.feature_importances_
        indices = np.argsort(importances)[::-1]
        
        feats = []
        for f in range(len(self.features)):
            feats.append({
                "feature": self.features[indices[f]],
                "importance": float(importances[indices[f]])
            })
        return feats

    def generate_future_forecast(self, df_processed, steps_horizon, granularity):
        """
        Generates future forecasts using Prophet, Random Forest (recursive autoregression), and the Hybrid weightings.
        """
        steps = int(steps_horizon)
        last_date = pd.to_datetime(df_processed[self.date_col].iloc[-1])
        
        # 1. Generate future timestamps
        if granularity == "hourly":
            future_dates = pd.date_range(start=last_date + pd.Timedelta(hours=1), periods=steps, freq='h')
        elif granularity == "daily":
            future_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=steps, freq='D')
        elif granularity == "weekly":
            future_dates = pd.date_range(start=last_date + pd.Timedelta(weeks=1), periods=steps, freq='W')
        else: # monthly
            future_dates = pd.date_range(start=last_date + pd.offsets.MonthEnd(1), periods=steps, freq='ME')
            
        # 2. Prophet Forecasting (provides prediction intervals)
        prophet_df = pd.DataFrame({'ds': future_dates})
        prophet_forecast = self.prophet_model.predict(prophet_df)
        prophet_preds = np.clip(prophet_forecast['yhat'].values, 0, None)
        yhat_lower = np.clip(prophet_forecast['yhat_lower'].values, 0, None)
        yhat_upper = np.clip(prophet_forecast['yhat_upper'].values, 0, None)
        
        # 3. Random Forest Autoregressive Forecasting
        rf_preds = self.predict_rf_recursive(df_processed, future_dates, granularity)
        rf_preds = np.clip(rf_preds, 0, None)
        
        # 4. Hybrid Prediction
        # Retrieve computed weights
        w_p = self.metrics.get("hybrid", {}).get("weights", {}).get("prophet", 0.5)
        w_rf = self.metrics.get("hybrid", {}).get("weights", {}).get("random_forest", 0.5)
        hybrid_preds = w_p * prophet_preds + w_rf * rf_preds
        
        # 5. Hybrid Confidence Intervals (centered around hybrid predictions)
        # Using Prophet's prediction interval width scaled around the hybrid forecast
        half_interval = (yhat_upper - yhat_lower) / 2.0
        hybrid_lower = np.clip(hybrid_preds - half_interval, 0, None)
        hybrid_upper = hybrid_preds + half_interval
        
        return {
            "dates": future_dates.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            "prophet": prophet_preds.tolist(),
            "random_forest": rf_preds.tolist(),
            "hybrid": hybrid_preds.tolist(),
            "lower_bound": hybrid_lower.tolist(),
            "upper_bound": hybrid_upper.tolist()
        }

    def predict_rf_recursive(self, df_processed, future_dates, granularity):
        """
        Iterative recursive forecasting logic for Random Forest:
        For each step, it builds the feature vector by shifting and calculating rolling values 
        using both past values and newly predicted values.
        """
        # Create a rolling dataframe containing the historical values and space for predictions
        historical_len = len(df_processed)
        history_df = df_processed.copy()
        
        # We need to append placeholder rows for future dates
        future_rows = []
        for dt in future_dates:
            row = {c: np.nan for c in df_processed.columns}
            row[self.date_col] = dt
            # Fill date features
            row["Year"] = dt.year
            row["Quarter"] = dt.quarter
            row["Month"] = dt.month
            row["Day"] = dt.day
            row["Weekday"] = dt.dayofweek
            row["Weekend"] = 1 if dt.dayofweek >= 5 else 0
            row["Hour"] = dt.hour
            row["Holiday"] = is_us_holiday(dt)
            row["Month_Sin"] = np.sin(2 * np.pi * dt.month / 12.0)
            row["Month_Cos"] = np.cos(2 * np.pi * dt.month / 12.0)
            row["Day_Sin"] = np.sin(2 * np.pi * dt.dayofweek / 7.0)
            row["Day_Cos"] = np.cos(2 * np.pi * dt.dayofweek / 7.0)
            row["Month_Start"] = 1 if dt.is_month_start else 0
            row["Month_End"] = 1 if dt.is_month_end else 0
            
            try:
                row["Week"] = int(dt.isocalendar()[1])
            except Exception:
                row["Week"] = int(dt.strftime('%U'))
                
            future_rows.append(row)
            
        future_df = pd.DataFrame(future_rows)
        full_df = pd.concat([history_df, future_df], axis=0).reset_index(drop=True)
        
        # Set lag and rolling windows based on granularity
        if granularity == "hourly":
            rolling_windows = [24, 168]
            lags = [1, 2, 24, 168]
        elif granularity == "daily":
            rolling_windows = [7, 30]
            lags = [1, 2, 7, 30]
        elif granularity == "weekly":
            rolling_windows = [4, 12]
            lags = [1, 2, 4, 52]
        else: # monthly
            rolling_windows = [3, 6]
            lags = [1, 2, 3, 12]
            
        # Recursive prediction loop
        for i in range(len(future_dates)):
            curr_idx = historical_len + i
            
            # Recalculate lag features for this step
            for lag in lags:
                full_df.loc[curr_idx, f"{self.target_col}_lag_{lag}"] = full_df.loc[curr_idx - lag, self.target_col]
                
            # Recalculate rolling features for this step using window ending at curr_idx - 1
            for w in rolling_windows:
                window_data = full_df.loc[curr_idx - w : curr_idx - 1, self.target_col]
                full_df.loc[curr_idx, f"{self.target_col}_roll_mean_{w}"] = window_data.mean()
                full_df.loc[curr_idx, f"{self.target_col}_roll_std_{w}"] = window_data.std() if len(window_data) > 1 else 0.0
                
            # Recalculate growth rate
            prev_val = full_df.loc[curr_idx, f"{self.target_col}_lag_1"]
            # To calculate growth, we need the prediction itself. Since we don't have it yet, 
            # we can approximate growth from lag_2 to lag_1
            lag_2 = full_df.loc[curr_idx, f"{self.target_col}_lag_2"]
            full_df.loc[curr_idx, f"{self.target_col}_growth_rate"] = (prev_val - lag_2) / (lag_2 + 1e-5)
            
            # Get feature row
            X_curr = full_df.loc[[curr_idx], self.features]
            
            # Make prediction
            try:
                pred_val = self.rf_model.predict(X_curr)[0]
            except Exception as e:
                print("DEBUG: Feature row contains unexpected types:")
                for col in X_curr.columns:
                    val = X_curr.loc[curr_idx, col]
                    if callable(val) or 'method' in str(type(val)) or isinstance(val, type(self.predict_rf_recursive)):
                        print(f"  Column '{col}': value is a method/callable: {val} of type {type(val)}")
                    elif isinstance(val, str):
                        print(f"  Column '{col}': value is string '{val}'")
                raise e
            pred_val = max(0, pred_val) # Clip negative predictions
            
            # Write prediction back to the target column
            full_df.loc[curr_idx, self.target_col] = pred_val
            
        # Extract predictions
        predictions = full_df.loc[historical_len:, self.target_col].values
        return predictions
        
def save_model(engine, target_name, base_path="backend/models/"):
    """
    Saves the ForecastEngine object to disk.
    """
    os.makedirs(base_path, exist_ok=True)
    file_path = os.path.join(base_path, f"engine_{target_name}.joblib")
    joblib.dump(engine, file_path)
    print(f"Saved forecasting engine for {target_name} to {file_path}")
    
def load_model(target_name, base_path="backend/models/"):
    """
    Loads a ForecastEngine object from disk.
    """
    file_path = os.path.join(base_path, f"engine_{target_name}.joblib")
    if os.path.exists(file_path):
        return joblib.load(file_path)
    return None
