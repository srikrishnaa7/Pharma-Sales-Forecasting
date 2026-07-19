import google.generativeai as genai
import os
import numpy as np
import pandas as pd
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

MEDICINE_COLUMNS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]

def generate_chatbot_response(
    user_message, 
    active_product, 
    horizon_days, 
    chat_history, 
    historical_df, 
    forecast_dict,
    start_date=None,
    end_date=None,
    granularity="daily"
):
    """
    Formulates a context-aware prompt containing historical metrics and future forecasts,
    then queries Gemini to retrieve a precise, data-grounded analytical answer.
    """
    # 1. Gather global historical metrics across all products
    global_hist_totals = {}
    best_selling_product = None
    best_selling_product_units = -1.0
    
    for prod in MEDICINE_COLUMNS:
        if prod in historical_df.columns:
            total_sold = float(historical_df[prod].sum())
            global_hist_totals[prod] = {
                "total": total_sold,
                "avg": float(historical_df[prod].mean()),
                "max": float(historical_df[prod].max()),
                "max_date": pd.to_datetime(historical_df.loc[historical_df[prod].idxmax(), 'datum']).strftime('%Y-%m-%d')
            }
            if total_sold > best_selling_product_units:
                best_selling_product_units = total_sold
                best_selling_product = prod
                
    # 2. Gather historical monthly sales and find highest sales month
    hist_copy = historical_df.copy()
    hist_copy['datum'] = pd.to_datetime(hist_copy['datum'])
    hist_copy['YearMonth'] = hist_copy['datum'].dt.to_period('M')
    active_targets = [c for c in MEDICINE_COLUMNS if c in historical_df.columns]
    monthly_sales_df = hist_copy.groupby('YearMonth')[active_targets].sum()
    monthly_sales_df['Total'] = monthly_sales_df.sum(axis=1)
    
    highest_sales_month = str(monthly_sales_df['Total'].idxmax()) if not monthly_sales_df.empty else "N/A"
    highest_sales_month_units = float(monthly_sales_df['Total'].max()) if not monthly_sales_df.empty else 0.0
    
    # Calculate highest sales month for each product
    product_highest_month = {}
    for prod in active_targets:
        if prod in monthly_sales_df.columns:
            peak_m = monthly_sales_df[prod].idxmax()
            product_highest_month[prod] = (str(peak_m), float(monthly_sales_df.loc[peak_m, prod]))
            
    # Monthly sales summary for all months (chronological)
    monthly_sales_summary = []
    for ym in monthly_sales_df.index:
        ym_str = str(ym)
        prods_str = ", ".join([f"{p}: {monthly_sales_df.loc[ym, p]:.2f}" for p in active_targets])
        monthly_sales_summary.append(f"  - {ym_str}: {prods_str} (Total: {monthly_sales_df.loc[ym, 'Total']:.2f})")
    monthly_sales_text = "\n".join(monthly_sales_summary)
    
    # 3. Gather active product historical metrics
    product_series = historical_df[active_product]
    total_historical = float(product_series.sum())
    avg_historical = float(product_series.mean())
    max_historical = float(product_series.max())
    max_date = pd.to_datetime(historical_df.loc[product_series.idxmax(), 'datum']).strftime('%Y-%m-%d')
    
    # 4. Gather forecast metrics for the active product
    future_dates = forecast_dict.get('dates', [])
    hybrid_forecast = forecast_dict.get('hybrid', [])
    prophet_forecast = forecast_dict.get('prophet', [])
    rf_forecast = forecast_dict.get('random_forest', [])
    
    # Filter arrays specifically between start_date and end_date if provided
    if start_date and end_date:
        start_dt = pd.to_datetime(start_date)
        end_dt = pd.to_datetime(end_date)
        
        filtered_dates = []
        filtered_hybrid = []
        filtered_prophet = []
        filtered_rf = []
        
        for idx, date_str in enumerate(future_dates):
            date_dt = pd.to_datetime(date_str)
            if start_dt <= date_dt <= end_dt:
                filtered_dates.append(date_str)
                filtered_hybrid.append(hybrid_forecast[idx])
                if idx < len(prophet_forecast):
                    filtered_prophet.append(prophet_forecast[idx])
                if idx < len(rf_forecast):
                    filtered_rf.append(rf_forecast[idx])
                    
        future_dates = filtered_dates
        hybrid_forecast = filtered_hybrid
        prophet_forecast = filtered_prophet
        rf_forecast = filtered_rf

    # Calculate summary statistics of the forecast
    total_forecast = float(sum(hybrid_forecast)) if hybrid_forecast else 0.0
    avg_forecast = float(np.mean(hybrid_forecast)) if hybrid_forecast else 0.0
    max_forecast = float(np.max(hybrid_forecast)) if hybrid_forecast else 0.0
    min_forecast = float(np.min(hybrid_forecast)) if hybrid_forecast else 0.0
    
    max_forecast_idx = np.argmax(hybrid_forecast) if hybrid_forecast else -1
    min_forecast_idx = np.argmin(hybrid_forecast) if hybrid_forecast else -1
    max_forecast_date = future_dates[max_forecast_idx].split(' ')[0] if max_forecast_idx >= 0 else "N/A"
    min_forecast_date = future_dates[min_forecast_idx].split(' ')[0] if min_forecast_idx >= 0 else "N/A"
    
    # Take a snippet of recent data and full future forecast
    recent_history_snippet = []
    for idx in range(max(0, len(historical_df) - 30), len(historical_df)):
        dt = pd.to_datetime(historical_df.loc[idx, 'datum']).strftime('%Y-%m-%d')
        val = float(historical_df.loc[idx, active_product])
        recent_history_snippet.append(f"{dt}: {val:.2f}")
        
    forecast_snippet = []
    for idx in range(len(future_dates)):
        dt = future_dates[idx].split(' ')[0]
        val = float(hybrid_forecast[idx])
        forecast_snippet.append(f"{dt}: {val:.2f}")
        
    # Aggregate forecast predictions to weekly and monthly predicted totals
    predicted_weekly_text = ""
    predicted_monthly_text = ""
    if future_dates and hybrid_forecast:
        forecast_df = pd.DataFrame({
            'date': pd.to_datetime(future_dates),
            'prediction': hybrid_forecast
        })
        
        # Weekly
        forecast_df['Week'] = forecast_df['date'].dt.to_period('W')
        weekly_forecast = forecast_df.groupby('Week')['prediction'].sum()
        weekly_forecast_summary = [f"  - Week {str(w)}: {val:.2f} units" for w, val in weekly_forecast.items()]
        predicted_weekly_text = "\n".join(weekly_forecast_summary)
        
        # Monthly
        forecast_df['Month'] = forecast_df['date'].dt.to_period('M')
        monthly_forecast = forecast_df.groupby('Month')['prediction'].sum()
        monthly_forecast_summary = [f"  - Month {str(m)}: {val:.2f} units" for m, val in monthly_forecast.items()]
        predicted_monthly_text = "\n".join(monthly_forecast_summary)

    # Calculate trend metrics
    trend_direction = "stable"
    if len(hybrid_forecast) > 1:
        first_half = hybrid_forecast[:len(hybrid_forecast)//2]
        second_half = hybrid_forecast[len(hybrid_forecast)//2:]
        mean_first = np.mean(first_half)
        mean_second = np.mean(second_half)
        pct_change = (mean_second - mean_first) / (mean_first + 1e-5) * 100
        if pct_change > 5:
            trend_direction = f"increasing (+{pct_change:.1f}%)"
        elif pct_change < -5:
            trend_direction = f"decreasing ({pct_change:.1f}%)"
        else:
            trend_direction = f"stable ({pct_change:+.1f}%)"

    # Compare historical average vs predicted average
    hist_to_pred_change = (avg_forecast - avg_historical) / (avg_historical + 1e-5) * 100

    # Build history context
    history_context = "\n".join([f"- {h}" for h in chat_history[-6:]]) if chat_history else "No previous conversation history."

    # 3. Construct System Prompt
    prompt = f"""
You are Pharma sales forecaster AI, an expert data scientist and pharmaceutical supply chain analyst. 
You answer user questions about sales trends and future predictions using the data context below. 

=== ACTIVE CONTEXT ===
- Medicine Category Code: {active_product}
- Granularity Level: {granularity}
- Selected Forecast Range: {start_date} to {end_date} ({len(future_dates)} steps)
- Forecast Trend Direction: {trend_direction}
- Change in Average (Historical vs Forecast): {hist_to_pred_change:+.2f}%

=== GLOBAL HISTORICAL SALES METRICS (ALL PRODUCTS) ===
- Best-selling product overall: {best_selling_product} ({best_selling_product_units:.2f} units)
- Product Totals, Averages, and Peaks:
{chr(10).join([f"  - {prod}: Total={stats['total']:.2f}, Avg={stats['avg']:.2f}, Peak={stats['max']:.2f} on {stats['max_date']}" for prod, stats in global_hist_totals.items()])}
- Month with highest overall historical sales: {highest_sales_month} ({highest_sales_month_units:.2f} units)
- Month with highest historical sales per product:
{chr(10).join([f"  - {prod}: Month {val[0]} ({val[1]:.2f} units)" for prod, val in product_highest_month.items()])}

=== MONTHLY HISTORICAL SALES TOTALS ===
{monthly_sales_text}

=== HISTORICAL SALES METRICS ({active_product}) ===
- Total Historical Units Sold: {total_historical:.2f}
- Average Historical Sales / Period: {avg_historical:.2f}
- Peak Historical Sales Recorded: {max_historical:.2f} on {max_date}
- Recent Historical Sales Trend (Last 30 records):
{chr(10).join(['  ' + item for item in recent_history_snippet])}

=== AI ENSEMBLE FORECAST METRICS (Selected Range) ===
- Total Predicted Sales: {total_forecast:.2f}
- Average Predicted Sales: {avg_forecast:.2f}
- Peak Predicted Sales: {max_forecast:.2f} on {max_forecast_date}
- Lowest Predicted Sales: {min_forecast:.2f} on {min_forecast_date}
- Detailed Predictions for all {len(future_dates)} steps:
{chr(10).join(['  ' + item for item in forecast_snippet])}

=== PREDICTED AGGREGATED TOTALS ===
- Predicted Weekly Sales:
{predicted_weekly_text if predicted_weekly_text else "  (Already weekly granularity)"}
- Predicted Monthly Sales:
{predicted_monthly_text if predicted_monthly_text else "  (Already monthly granularity)"}

=== CONVERSATION HISTORY ===
{history_context}

=== USER QUESTION ===
"{user_message}"

=== INSTRUCTIONS ===
1. Respond to the user's question directly, clearly, and concisely using ONLY the provided data.
2. Rely ONLY on the provided context. If a metric or trend is not directly deducible from the context, state that you do not have that data point.
3. Keep your tone objective, data-driven, and highly professional.
4. Perform any calculations (e.g., comparing averages, calculating percentage changes) accurately.
5. If the user asks simple greetings (e.g., "Hi", "Hello"), respond politely and invite them to ask about the active dataset or forecast.
6. Reference specific numbers (like total predicted sales, peaks, or dates) when answering questions.
7. Structure your response using clean Markdown. Use headings, bullet lists, bold text highlights, or markdown tables where appropriate to present data in a structured, readable way.
"""

    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables.")
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-3.5-flash')
        response = model.generate_content(prompt)
        if response and response.text:
            return response.text.strip()
        else:
            raise Exception("Empty response from Gemini API.")
    except Exception as e:
        print(f"Gemini Chatbot connection failed: {str(e)}. Using fallback response...")
        return get_chatbot_fallback(
            user_message, active_product, horizon_days, total_historical, total_forecast, 
            start_date, end_date, granularity, global_hist_totals, monthly_sales_df, 
            predicted_weekly_text, predicted_monthly_text, best_selling_product
        )

def get_chatbot_fallback(
    message, product, horizon, total_hist, total_fore, start_date, end_date, granularity,
    global_hist_totals, monthly_sales_df, predicted_weekly_text, predicted_monthly_text, 
    best_selling_product
):
    """
    Standard fallback response for the chatbot in case of network issues.
    Uses calculated structures for data-rich offline replies.
    """
    msg = message.lower()
    
    # 1. Historical product sales comparison
    if "sold the most" in msg or "most sold" in msg:
        if best_selling_product:
            val = global_hist_totals[best_selling_product]['total']
            return f"According to historical logs, the product that sold the most units is {best_selling_product} with a total volume of {val:.2f} units."
        return "I don't have global sales totals parsed in offline mode."
        
    elif "compare" in msg:
        # Find which products are mentioned
        matches = [p for p in MEDICINE_COLUMNS if p.lower() in msg]
        if len(matches) >= 2:
            p1, p2 = matches[0], matches[1]
            tot1 = global_hist_totals.get(p1, {}).get('total', 0)
            tot2 = global_hist_totals.get(p2, {}).get('total', 0)
            diff = abs(tot1 - tot2)
            better = p1 if tot1 > tot2 else p2
            return f"Comparing historical volumes: {p1} sold {tot1:.2f} units, while {p2} sold {tot2:.2f} units. {better} has higher sales by {diff:.2f} units."
        return f"Historical total sales for {product} is {total_hist:.2f} units. Please mention two product codes (e.g. M01AB, N02BE) to compare."

    # 2. Historical monthly sales
    elif "monthly sales" in msg:
        # Return recent monthly sales (last 5 months from monthly_sales_df)
        if not monthly_sales_df.empty:
            recent_m = monthly_sales_df.tail(5)
            summary_lines = []
            for idx in recent_m.index:
                summary_lines.append(f"- Month {str(idx)}: {product} = {recent_m.loc[idx, product]:.2f} units (Total across all products = {recent_m.loc[idx, 'Total']:.2f} units)")
            return "Here are the recent historical monthly sales totals:\n" + "\n".join(summary_lines)
        return "Monthly historical sales data is not available offline."

    elif "highest sales" in msg or "highest month" in msg or "peak sales" in msg:
        if not monthly_sales_df.empty:
            peak_m = monthly_sales_df['Total'].idxmax()
            peak_val = monthly_sales_df.loc[peak_m, 'Total']
            return f"The month with the highest overall historical sales was {str(peak_m)} with a total of {peak_val:.2f} units sold across all products."
        return "Historical sales data is not available offline."

    # 3. Forecast values
    elif "predicted sales next month" in msg or "next month" in msg:
        # Find month totals in predicted_monthly_text
        if predicted_monthly_text:
            return f"Here are the predicted monthly totals in the selected range:\n{predicted_monthly_text}"
        return f"The predicted sales for the forecast period ({start_date} to {end_date}) is {total_fore:.2f} units."

    elif "predicted weekly totals" in msg or "weekly totals" in msg:
        if predicted_weekly_text:
            return f"Here are the predicted weekly totals in the selected range:\n{predicted_weekly_text}"
        return "Weekly forecast aggregation is only available for daily or hourly granularity."

    elif "predicted monthly totals" in msg or "monthly totals" in msg:
        if predicted_monthly_text:
            return f"Here are the predicted monthly totals in the selected range:\n{predicted_monthly_text}"
        return "Monthly forecast aggregation is only available for daily or weekly granularity."

    elif "predict" in msg or "forecast" in msg or "will be" in msg:
        return f"Based on the historical baseline for {product}, the hybrid Prophet + Random Forest model predicts a total sales volume of {total_fore:.1f} units over the range {start_date} to {end_date} ({granularity} granularity)."
        
    elif "trend" in msg or "increasing" in msg or "decreasing" in msg:
        # Compare first and last half
        return f"The forecast trend for {product} from {start_date} to {end_date} is calculated as a total of {total_fore:.1f} units with {granularity} granularity. Look at the chart visualization for detailed confidence bands."

    else:
        return f"Hello! I am Pharma sales forecaster AI. I can assist you in analyzing {product} for a {granularity} forecasting window from {start_date} to {end_date}, representing {total_hist:.1f} units of historical sales and {total_fore:.1f} units of predicted sales."
