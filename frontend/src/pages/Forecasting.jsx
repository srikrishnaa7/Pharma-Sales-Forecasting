import React, { useState, useEffect, useRef } from 'react';
import { 
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LineChart, Line 
} from 'recharts';
import { RefreshCcw, Sparkles, AlertCircle, Send, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';

const PRODUCT_LIST = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"];

const PRODUCT_DETAILS = {
  "M01AB": "Anti-inflammatory (Acetic acid derivatives)",
  "M01AE": "Anti-inflammatory (Propionic acid derivatives - e.g. Ibuprofen)",
  "N02BA": "Salicylic acid derivatives (Analgesics)",
  "N02BE": "Anilides (Analgesics/Antipyretics - e.g. Paracetamol)",
  "N05B": "Anxiolytic psycholeptics",
  "N05C": "Hypnotics and sedatives",
  "R03": "Obstructive airway diseases drugs (Asthma)",
  "R06": "Systemic antihistamines"
};

const getMinDateStr = (lastDateStr) => {
  if (!lastDateStr) return '';
  const date = new Date(lastDateStr);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const getDefaultDates = (lastDateStr) => {
  if (!lastDateStr) return { start: '', end: '' };
  const lastDate = new Date(lastDateStr);
  const startDate = new Date(lastDate);
  startDate.setDate(startDate.getDate() + 1);
  const startStr = startDate.toISOString().split('T')[0];
  
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 90); // 90 days default
  const endStr = endDate.toISOString().split('T')[0];
  
  return { start: startStr, end: endStr };
};

const SUGGESTED_QUESTIONS = [
  "What is the expected sales trend between the selected dates?",
  "Which week has the highest predicted sales?",
  "Is the forecast increasing or decreasing?",
  "Summarize the generated forecast.",
  "Compare historical and predicted sales.",
  "What are the predicted monthly totals?",
  "What are the predicted weekly totals?"
];

// Reusable Sub-component for rendering each granularity
function ForecastSection({ title, forecast, product, productName }) {
  const [isOpen, setIsOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  if (!forecast) return null;

  const formatNumber = (val) => new Intl.NumberFormat('en-US').format(val);

  // Format historical + forecast data for Historical vs Forecast Chart
  const historicalChartData = forecast.historical_data.map(d => ({
    date: d.date,
    actual: Number(d.sales.toFixed(2)),
    forecast: null
  }));

  const forecastChartData = forecast.forecast_data.map(d => ({
    date: d.date,
    actual: null,
    forecast: Number(d.prediction.toFixed(2))
  }));

  // Bridge the gap continuously
  if (historicalChartData.length > 0 && forecastChartData.length > 0) {
    const lastHist = historicalChartData[historicalChartData.length - 1];
    forecastChartData.unshift({
      date: lastHist.date,
      actual: lastHist.actual,
      forecast: lastHist.actual
    });
  }

  const combinedChartData = [...historicalChartData, ...forecastChartData];

  // Format forecast data only for the Forecast-Only Area Chart
  const forecastChartDataOnly = forecast.forecast_data.map(d => ({
    date: d.date,
    prophet: Number(d.prophet.toFixed(2)),
    rf: Number(d.random_forest.toFixed(2)),
    hybrid: Number(d.prediction.toFixed(2)),
    confidenceRange: [
      Number(d.lower_bound.toFixed(2)),
      Number(d.upper_bound.toFixed(2))
    ]
  }));

  // Table pagination details
  const tableData = forecast.forecast_data.map(d => ({
    date: d.date,
    prophet: d.prophet,
    rf: d.random_forest,
    hybrid: d.prediction,
    lower: d.lower_bound,
    upper: d.upper_bound
  }));

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = tableData.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(tableData.length / itemsPerPage);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
      {/* Section Header */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-6 bg-violet-600 rounded-full"></div>
          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider text-left">{title}</h3>
        </div>
        <div className="text-slate-400">
          {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-6 space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Sales</span>
              <h4 className="text-base font-black text-violet-600 dark:text-violet-400 mt-2">
                {formatNumber(forecast.summary_statistics.total_predicted_sales.toFixed(2))} units
              </h4>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Avg Sales / Period</span>
              <h4 className="text-base font-black text-indigo-600 dark:text-indigo-400 mt-2">
                {formatNumber(forecast.summary_statistics.average_predicted_sales.toFixed(2))} units
              </h4>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Highest Sales</span>
              <h4 className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-2">
                {formatNumber(forecast.summary_statistics.highest_predicted_sales.toFixed(2))} units
              </h4>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Lowest Sales</span>
              <h4 className="text-base font-black text-rose-600 dark:text-rose-400 mt-2">
                {formatNumber(forecast.summary_statistics.lowest_predicted_sales.toFixed(2))} units
              </h4>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart A - Historical vs Forecast */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
              <h4 className="font-extrabold text-[11px] uppercase text-slate-400 tracking-wider mb-4">Historical Baseline vs Forecast Trend</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combinedChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '12px', background: '#0f172a', color: '#fff', border: 'none' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                    <Line type="monotone" name="Historical Sales" dataKey="actual" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" name="Predicted Trend (Hybrid)" dataKey="forecast" stroke="#ec4899" strokeWidth={2.5} dot={false} strokeDasharray="4 4" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart B - Forecast Only Detail Chart */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-extrabold text-[11px] uppercase text-slate-400 tracking-wider">Forecast Only Detail Trend</h4>
                <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-400 rounded-md text-[8px] font-extrabold uppercase">
                  95% Confidence Band
                </span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastChartDataOnly}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '12px', background: '#0f172a', color: '#fff', border: 'none' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                    
                    <Area 
                      name="Confidence Range" 
                      dataKey="confidenceRange" 
                      stroke="none" 
                      fill="#8b5cf6" 
                      fillOpacity={0.08} 
                    />
                    
                    <Area type="monotone" name="Prophet Forecast" dataKey="prophet" stroke="#3b82f6" strokeWidth={1.2} fill="none" strokeDasharray="3 3" />
                    <Area type="monotone" name="Random Forest Forecast" dataKey="rf" stroke="#10b981" strokeWidth={1.2} fill="none" strokeDasharray="3 3" />
                    <Area type="monotone" name="Hybrid Forecast" dataKey="hybrid" stroke="#8b5cf6" strokeWidth={2.2} fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-semibold whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-400">
                    <th className="py-2.5 px-5">Future Date</th>
                    <th className="py-2.5 px-5 text-right">Prophet</th>
                    <th className="py-2.5 px-5 text-right">Random Forest</th>
                    <th className="py-2.5 px-5 text-right">Hybrid Model</th>
                    <th className="py-2.5 px-5 text-right">Confidence Interval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-350">
                  {currentItems.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                      <td className="py-2.5 px-5 font-bold">{row.date}</td>
                      <td className="py-2.5 px-5 text-right">{row.prophet.toFixed(2)}</td>
                      <td className="py-2.5 px-5 text-right">{row.rf.toFixed(2)}</td>
                      <td className="py-2.5 px-5 text-right font-black text-violet-600 dark:text-violet-400">{row.hybrid.toFixed(2)}</td>
                      <td className="py-2.5 px-5 text-right font-bold text-slate-500 dark:text-slate-400">
                        [{row.lower.toFixed(2)} - {row.upper.toFixed(2)}]
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/20">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Previous
                </button>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                  Page {currentPage} of {totalPages}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-bold disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Forecasting() {
  // Forecast controls state
  const [product, setProduct] = useState("M01AB");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  // Date limits for date pickers
  const [minStartDate, setMinStartDate] = useState("");
  const [minEndDate, setMinEndDate] = useState("");
  const [lastHistoricalDate, setLastHistoricalDate] = useState("");
  
  // Data states for all 3 granularities
  const [dailyForecast, setDailyForecast] = useState(null);
  const [weeklyForecast, setWeeklyForecast] = useState(null);
  const [monthlyForecast, setMonthlyForecast] = useState(null);
  
  // UI states
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');

  // Chatbot panel state
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Welcome to Pharma sales forecaster AI. Ask me about daily, weekly, or monthly forecast predictions in the active date range.', timestamp: '' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Initialize page and load default forecasts in parallel
  useEffect(() => {
    const initPage = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch statuses to resolve maximum historical date
        const [dailyStat, weeklyStat, monthlyStat] = await Promise.all([
          api.getStatus('daily'),
          api.getStatus('weekly'),
          api.getStatus('monthly')
        ]);
        
        // Find the maximum date
        const maxDate = new Date(Math.max(
          new Date(dailyStat.last_historical_date),
          new Date(weeklyStat.last_historical_date),
          new Date(monthlyStat.last_historical_date)
        ));
        const maxDateStr = maxDate.toISOString().split('T')[0];
        setLastHistoricalDate(maxDateStr);
        
        const computedMinDate = getMinDateStr(maxDateStr);
        setMinStartDate(computedMinDate);
        
        const defaultDates = getDefaultDates(maxDateStr);
        setStartDate(defaultDates.start);
        setEndDate(defaultDates.end);
        setMinEndDate(getMinDateStr(defaultDates.start));
        
        // Fetch initial forecasts in parallel
        const [dailyRes, weeklyRes, monthlyRes] = await Promise.all([
          api.getForecast(product, defaultDates.start, defaultDates.end, 'daily'),
          api.getForecast(product, defaultDates.start, defaultDates.end, 'weekly'),
          api.getForecast(product, defaultDates.start, defaultDates.end, 'monthly')
        ]);
        
        setDailyForecast(dailyRes);
        setWeeklyForecast(weeklyRes);
        setMonthlyForecast(monthlyRes);
        
        // Get initial chat history
        const chatHist = await api.getChatHistory();
        if (chatHist && chatHist.length > 0) {
          setChatMessages(chatHist);
        }
      } catch (err) {
        console.error(err);
        setError('Could not connect to backend to pull forecast profiles.');
      } finally {
        setLoading(false);
      }
    };
    initPage();
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Execute Parallel Forecast generation
  const handlePredict = async () => {
    if (!startDate || !endDate) {
      setValidationError("Please select both start and end dates.");
      return;
    }
    
    const startDt = new Date(startDate);
    const endDt = new Date(endDate);
    const lastHistDt = new Date(lastHistoricalDate);
    
    if (startDt <= lastHistDt) {
      setValidationError(`Start date must be after the last historical date (${lastHistoricalDate}).`);
      return;
    }
    
    if (endDt <= startDt) {
      setValidationError("End date must be after the start date.");
      return;
    }
    
    setValidationError("");
    setPredicting(true);
    setError("");
    try {
      // Execute parallel predictions
      const [dailyRes, weeklyRes, monthlyRes] = await Promise.all([
        api.getForecast(product, startDate, endDate, 'daily'),
        api.getForecast(product, startDate, endDate, 'weekly'),
        api.getForecast(product, startDate, endDate, 'monthly')
      ]);
      
      setDailyForecast(dailyRes);
      setWeeklyForecast(weeklyRes);
      setMonthlyForecast(monthlyRes);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || 'Failed to generate predictions. Check parameters.');
    } finally {
      setPredicting(false);
    }
  };

  // Chat message submission (defaults to Daily/High resolution query granularity)
  const handleSendChat = async (e, textToSend = null) => {
    if (e) e.preventDefault();
    const query = textToSend || chatInput;
    if (!query.trim()) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { role: 'user', content: query, timestamp: time }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await api.sendChatMessage(query, product, startDate, endDate, 'daily');
      setChatMessages(prev => [...prev, { role: 'assistant', content: res.response, timestamp: time }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Connection timed out. Check your Gemini API key.', timestamp: time }]);
    } finally {
      setChatLoading(false);
    }
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin"></div>
        <p className="text-slate-500 font-semibold text-sm animate-pulse">Running Monte Carlo Simulations in Parallel...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 items-start">
      {/* Left Column (3/4 width on desktop) */}
      <div className="xl:col-span-3 space-y-6">
        
        {/* Forecast Controls Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Medicine Category</label>
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none focus:border-violet-500 text-slate-800 dark:text-slate-100"
              >
                {PRODUCT_LIST.map(p => (
                  <option key={p} value={p}>{p} - {PRODUCT_DETAILS[p]}</option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                min={minStartDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setMinEndDate(getMinDateStr(e.target.value));
                }}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none focus:border-violet-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="flex-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                min={minEndDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none focus:border-violet-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <button
              onClick={handlePredict}
              disabled={predicting}
              className="w-full md:w-auto px-8 py-2.5 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2 shrink-0 h-[38px]"
            >
              {predicting ? <RefreshCcw className="w-4 h-4 animate-spin" /> : null}
              Generate Forecasts
            </button>
          </div>

          {/* Validation & Error Messages */}
          {validationError && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-400 text-xs rounded-xl flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}
          
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          
          <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5 pl-1">
            <Info className="w-3.5 h-3.5" />
            <span>Dataset history ends on: <strong className="text-violet-600 dark:text-violet-400">{lastHistoricalDate}</strong>. Predictions are allowed from the next day.</span>
          </div>
        </div>

        {/* Quick Jump Navbar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-sm flex items-center justify-between text-xs font-bold text-slate-500">
          <span>Jump to results:</span>
          <div className="flex gap-4">
            <button onClick={() => scrollToSection("daily-section")} className="text-violet-600 hover:underline">Daily Forecast</button>
            <span className="text-slate-300">|</span>
            <button onClick={() => scrollToSection("weekly-section")} className="text-violet-600 hover:underline">Weekly Forecast</button>
            <span className="text-slate-300">|</span>
            <button onClick={() => scrollToSection("monthly-section")} className="text-violet-600 hover:underline">Monthly Forecast</button>
          </div>
        </div>

        {/* Granularities Result Sections */}
        <div id="daily-section" className="space-y-6">
          <ForecastSection 
            title="Daily Forecast" 
            forecast={dailyForecast} 
            product={product} 
            productName={PRODUCT_DETAILS[product]} 
          />
        </div>

        <div id="weekly-section" className="space-y-6">
          <ForecastSection 
            title="Weekly Forecast" 
            forecast={weeklyForecast} 
            product={product} 
            productName={PRODUCT_DETAILS[product]} 
          />
        </div>

        <div id="monthly-section" className="space-y-6">
          <ForecastSection 
            title="Monthly Forecast" 
            forecast={monthlyForecast} 
            product={product} 
            productName={PRODUCT_DETAILS[product]} 
          />
        </div>
      </div>

      {/* Right Column - AI Chatbot Panel (1/4 width, sticky) */}
      <div className="xl:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl h-[700px] shadow-sm flex flex-col overflow-hidden xl:sticky xl:top-20">
        
        {/* Chat Title */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600 animate-pulse" />
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Pharma sales forecaster AI</h3>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-400 font-bold text-[9px]">
            Active
          </span>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-semibold">
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-250 rounded-tl-none border border-slate-200/40 dark:border-slate-700/40'
              }`}>
                {msg.content}
              </div>
              <span className="text-[9px] text-slate-400 mt-1 font-bold">{msg.timestamp}</span>
            </div>
          ))}
          {chatLoading && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold animate-pulse">
              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing context...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Suggested Quick Prompts */}
        <div className="px-4 py-2 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-850">
          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Quick Queries</span>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={(e) => handleSendChat(e, q)}
                disabled={chatLoading}
                className="whitespace-nowrap px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-[9px] text-slate-600 dark:text-slate-400 font-bold hover:border-violet-400 dark:hover:border-violet-800 hover:text-violet-600 dark:hover:text-violet-400 transition-all shrink-0"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <form onSubmit={(e) => handleSendChat(e)} className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="relative">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={chatLoading}
              placeholder="Ask about active historical or predicted trends..."
              className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:border-violet-500 placeholder-slate-400 font-semibold text-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="absolute right-2 top-2 p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
