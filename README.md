# AegisPharma: AI-Powered Sales Analytics & Forecasting Platform

AegisPharma is an industry-grade, production-ready pharmaceutical sales analytics and forecasting platform designed for commercial managers and distributors. It automatically digests sales data, preprocesses it, fits a **Hybrid FB Prophet + Random Forest Ensemble**, and generates strategic business suggestions using **Google Gemini LLM**.

---

## 1. System Architecture

The application comprises:
1. **React.js Frontend**: A dark-mode responsive analytics panel styled with Tailwind CSS, showing metrics in Recharts.
2. **FastAPI Backend**: Hosts the endpoints for database analysis, JWT security, custom CSV processing, and AI integrations.
3. **ML Forecasting Engine**: A custom hybrid time-series formulation merging additive regression (Prophet) and bagging tree regressors (Random Forest).
4. **Gemini AI Consultant**: Converts metrics, growth rates, and model predictions into executive strategic summaries.

```
e:/Downloads/cts/
│
├── backend/
│   ├── app/
│   │   ├── services/
│   │   │   ├── preprocessing.py   # Outliers, feature engineering, scaling
│   │   │   ├── forecasting.py     # Prophet + Random Forest ensemble
│   │   │   └── insights.py        # Gemini AI report generator
│   │   └── main.py                # REST routers & JWT Auth
│   ├── models/                    # Saved Joblib forecasting binaries
│   ├── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx         # Sidebar, Header, Alerts drawer
│   │   ├── pages/
│   │   │   ├── Login.jsx          # JWT login portal (Admin/Analyst)
│   │   │   ├── Dashboard.jsx      # Recharts KPI dashboards
│   │   │   ├── Forecasting.jsx    # Shaded confidence band area plots
│   │   │   ├── Products.jsx       # Inventory catalog with paging
│   │   │   ├── Regions.jsx        # Simulated regional pie-charts
│   │   │   ├── Insights.jsx       # Markdown reader & PDF printing
│   │   │   └── Settings.jsx       # CSV Uploader & Retraining status
│   │   ├── services/
│   │   │   └── api.js             # Axios client interceptors
│   │   └── App.jsx                # Layout page switcher
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
│
└── README.md
```

---

## 2. Preprocessing & ML Pipeline

### Phase A: Data Preprocessing
- **Granularity Detection**: Evaluates consecutive time intervals automatically to classify datasets into Hourly, Daily, Weekly, or Monthly buckets.
- **Missing Values**: Imputes numeric columns using Linear Interpolation, falling back to Median/Mean values. Imputes categorical features using Mode.
- **Outlier Capping**: Computes IQR (Interquartile Range) and Z-Scores to detect outliers, automatically capping extreme values to prevent RF tree skew.
- **Feature Engineering**: Generates datetime components (Sin/Cos cyclic values), rolling average profiles, lags (1, 7, 30 days depending on granularity), and rolling growth rates.

### Phase B: Hybrid ML Forecasting Model
The forecasting strategy merges:
1. **FB Prophet**: Captures macro seasonal effects (annual variations, holidays) as a function of time.
2. **Random Forest Regressor**: Captures micro autoregressive variations using lag features and rolling averages.

#### Hybrid Forecast Equation:
$$\hat{Y}_{t} = W_{\text{Prophet}} \cdot \hat{Y}_{\text{Prophet}, t} + W_{\text{RF}} \cdot \hat{Y}_{\text{RF}, t}$$

*Weights are computed dynamically on startup based on validation set performance (inverse Mean Absolute Error weights, capped between 0.2 and 0.8).*

---

## 3. Quick Start Guide

### Prerequisites
- Python 3.10+
- Node.js 18+

### Step A: Start the Backend REST API
1. Open a terminal and navigate to the backend folder:
   ```bash
   pip install -r backend/requirements.txt
   ```
2. Launch the FastAPI server:
   ```bash
   python backend/app/main.py
   ```
   *The server runs at http://127.0.0.1:8000 and automatically trains models for the 8 pharmaceutical categories in the background on startup.*
3. Open http://127.0.0.1:8000/docs in your browser to view the interactive **Swagger API documentation**.

### Step B: Start the React Frontend
1. Open a separate terminal and navigate to the frontend folder.
2. Launch the React development server:
   ```bash
   npm run dev
   ```
3. Open http://localhost:5173 in your browser to interact with the platform.

### Credentials
- **Admin**: Username `admin`, Password `adminpassword` (Full access)
- **Analyst**: Username `analyst`, Password `analystpassword` (Read-only access)
