import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  ShoppingCart, 
  TrendingUp, 
  HelpCircle, 
  RefreshCcw, 
  Send,
  MessageSquare,
  Sparkles,
  BarChart2
} from 'lucide-react';
import { api } from '../services/api';

const PRODUCT_LIST = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"];

const calculateSteps = (lastDateStr, targetDateStr, granularity) => {
  if (!lastDateStr || !targetDateStr) return 90;
  const lastDate = new Date(lastDateStr);
  const targetDate = new Date(targetDateStr);
  const diffTime = targetDate - lastDate;
  if (diffTime <= 0) return 1;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  
  switch (granularity) {
    case 'hourly':
      return Math.max(1, Math.round(diffDays * 24));
    case 'weekly':
      return Math.max(1, Math.ceil(diffDays / 7));
    case 'monthly':
      return Math.max(1, Math.ceil(diffDays / 30.5));
    case 'daily':
    default:
      return Math.max(1, Math.round(diffDays));
  }
};

const getMinDateStr = (lastDateStr) => {
  if (!lastDateStr) return '';
  const date = new Date(lastDateStr);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const getDefaultTargetDate = (lastDateStr, granularity) => {
  if (!lastDateStr) return '';
  const date = new Date(lastDateStr);
  if (granularity === 'hourly') {
    date.setDate(date.getDate() + 3);
  } else if (granularity === 'weekly') {
    date.setDate(date.getDate() + 90);
  } else if (granularity === 'monthly') {
    date.setDate(date.getDate() + 365);
  } else {
    date.setDate(date.getDate() + 90);
  }
  return date.toISOString().split('T')[0];
};

const getPeriodLabel = (steps, granularity) => {
  if (!granularity) return `${steps} Steps`;
  switch (granularity) {
    case 'hourly':
      return `${steps} Hours`;
    case 'weekly':
      return `${steps} Weeks`;
    case 'monthly':
      return `${steps} Months`;
    case 'daily':
    default:
      return `${steps} Days`;
  }
};

export default function Dashboard() {
  // Filters state
  const [product, setProduct] = useState("M01AB");
  const [targetDate, setTargetDate] = useState("");
  const [minDate, setMinDate] = useState("");
  const [datasetStatus, setDatasetStatus] = useState(null);
  const [horizon, setHorizon] = useState(90);
  
  // Dashboard metrics & chart data
  const [history, setHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');

  // Chatbot state
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hello! I am Pharma sales forecaster AI. Ask me anything about the current sales dataset or forecast trends!', timestamp: '' }
  ]);
  const [userInput, setUserInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const fetchDashboardData = async (triggerPredict = false) => {
    if (triggerPredict) setPredicting(true);
    else setLoading(true);
    
    setError('');
    try {
      // 1. Fetch status to resolve dates and granularity
      const stat = await api.getStatus();
      setDatasetStatus(stat);
      
      const computedMinDate = getMinDateStr(stat.last_historical_date);
      setMinDate(computedMinDate);
      
      let initialTarget = targetDate;
      if (!initialTarget) {
        initialTarget = getDefaultTargetDate(stat.last_historical_date, stat.granularity);
        setTargetDate(initialTarget);
      }
      
      const steps = calculateSteps(stat.last_historical_date, initialTarget, stat.granularity);
      setHorizon(steps);

      // 2. Fetch sales history
      const historyData = await api.getSalesHistory();
      setHistory(historyData);
      
      // 3. Fetch forecast
      const forecastData = await api.getForecast(product, steps);
      setForecast(forecastData);
    } catch (err) {
      console.error(err);
      setError('Could not connect to the backend server. Make sure FastAPI is running.');
    } finally {
      setLoading(false);
      setPredicting(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handlePredictClick = () => {
    fetchDashboardData(true);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    const userMsg = userInput;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add user message to UI
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: time }]);
    setUserInput('');
    setChatLoading(true);

    try {
      const steps = calculateSteps(datasetStatus?.last_historical_date, targetDate, datasetStatus?.granularity);
      const response = await api.sendChatMessage(userMsg, product, steps);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response.response, 
        timestamp: time 
      }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I failed to process that request. Check your Gemini connection.', 
        timestamp: time 
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin"></div>
        <p className="text-slate-500 font-semibold text-sm animate-pulse">Running Monte Carlo Simulations...</p>
      </div>
    );
  }

  if (error || !forecast) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 rounded-3xl">
        <p className="font-bold">Failed to load dashboard metrics.</p>
        <p className="text-xs mt-1">{error}</p>
        <button onClick={() => fetchDashboardData()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold transition-all">Retry</button>
      </div>
    );
  }

  // Formatting helpers
  const formatNumber = (val) => new Intl.NumberFormat('en-US').format(val);
  const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

  // Dynamic calculations based on product and forecast
  const historicalTotal = history.reduce((sum, row) => sum + (row[product] || 0), 0);
  const predictedTotal = forecast.future_forecast.hybrid.reduce((sum, val) => sum + val, 0);

  // Combined History & Forecast for Recharts
  // Take last 30 points of history and append future predictions
  const recentHistory = history.slice(-30).map(row => ({
    date: row.datum.split(' ')[0],
    actual: Number(row[product].toFixed(2)),
    forecast: null
  }));
  
  const futureForecast = forecast.future_forecast.dates.map((date, idx) => ({
    date: date.split(' ')[0],
    actual: null,
    forecast: Number(forecast.future_forecast.hybrid[idx].toFixed(2))
  }));
  
  const lineChartData = [...recentHistory, ...futureForecast];

  // Actual vs Predicted validation comparisons
  const valComp = forecast.validation_comparison;
  const valChartData = valComp.dates.map((date, idx) => ({
    date: date.split(' ')[0],
    actual: Number(valComp.actual[idx].toFixed(2)),
    predicted: Number(valComp.hybrid[idx].toFixed(2))
  }));

  // Forecast table preview list (First 5 records)
  const previewForecast = forecast.future_forecast.dates.slice(0, 5).map((date, idx) => ({
    date: date.split(' ')[0],
    prophet: forecast.future_forecast.prophet[idx],
    rf: forecast.future_forecast.random_forest[idx],
    hybrid: forecast.future_forecast.hybrid[idx]
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
      {/* Left Columns - Filters, Metrics, & Charts (2/3 width) */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* Configuration Filters */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Product Category</label>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none focus:border-violet-500 text-slate-800 dark:text-slate-100"
            >
              {PRODUCT_LIST.map(p => (
                <option key={p} value={p}>{p} Sales Class</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Target Date (Calendar)</label>
            <input
              type="date"
              value={targetDate}
              min={minDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                if (datasetStatus) {
                  const steps = calculateSteps(datasetStatus.last_historical_date, e.target.value, datasetStatus.granularity);
                  setHorizon(steps);
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none focus:border-violet-500 text-slate-800 dark:text-slate-100"
            />
          </div>

          <button
            onClick={handlePredictClick}
            disabled={predicting}
            className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {predicting ? <RefreshCcw className="w-4 h-4 animate-spin" /> : null}
            Generate Prediction
          </button>
        </div>

        {/* KPI Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Historical Sales</span>
            <h4 className="text-lg font-black text-slate-900 dark:text-white mt-1">{formatNumber(historicalTotal)}</h4>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Forecasted Sales</span>
            <h4 className="text-lg font-black text-slate-900 dark:text-white mt-1">{formatNumber(predictedTotal)}</h4>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Selected Product</span>
            <h4 className="text-lg font-black text-violet-600 dark:text-violet-400 mt-1 uppercase">{product}</h4>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Forecast Period</span>
            <h4 className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-1">
              {getPeriodLabel(horizon, datasetStatus?.granularity)}
            </h4>
          </div>
        </div>

        {/* Historical and Forecast Trend Chart */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm">
          <h3 className="font-extrabold text-xs uppercase text-slate-400 tracking-wider mb-6">Historical sales & AI Forecast Trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '12px', background: '#0f172a', color: '#fff', border: 'none' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                <Line type="monotone" name="Recent History" dataKey="actual" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" name="Future Forecast (Hybrid)" dataKey="forecast" stroke="#ec4899" strokeWidth={2.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Actual vs Predicted Validation Chart */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm">
          <h3 className="font-extrabold text-xs uppercase text-slate-400 tracking-wider mb-6">Ensemble Model Validation (Actual vs Predicted)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={valChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '12px', background: '#0f172a', color: '#fff', border: 'none' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                <Line type="monotone" name="Validation Actual" dataKey="actual" stroke="#1e293b" strokeWidth={1.5} dot={false} />
                <Line type="monotone" name="Hybrid Prediction" dataKey="predicted" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Forecast Summary Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-extrabold text-xs uppercase text-slate-400 tracking-wider">Recent Forecast Preview</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 bg-slate-50/50 dark:bg-slate-800/10">
                  <th className="py-3 px-6">Future Date</th>
                  <th className="py-3 px-6 text-right">Prophet prediction</th>
                  <th className="py-3 px-6 text-right">Random Forest prediction</th>
                  <th className="py-3 px-6 text-right">Hybrid Ensemble (Combined)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {previewForecast.map((row) => (
                  <tr key={row.date} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                    <td className="py-3.5 px-6 font-bold">{row.date}</td>
                    <td className="py-3.5 px-6 text-right">{row.prophet.toFixed(2)}</td>
                    <td className="py-3.5 px-6 text-right">{row.rf.toFixed(2)}</td>
                    <td className="py-3.5 px-6 text-right font-black text-violet-600 dark:text-violet-400">{row.hybrid.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Column - AI Chatbot Panel (1/3 width) */}
      <aside className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl h-[650px] shadow-sm flex flex-col overflow-hidden sticky top-20">
        {/* Chat Title */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Pharma sales forecaster AI Chat</h3>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-400 font-bold text-[9px]">
            Connected
          </span>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-semibold">
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none border border-slate-200/40 dark:border-slate-700/40'
              }`}>
                {msg.content}
              </div>
              <span className="text-[9px] text-slate-400 mt-1 font-bold">{msg.timestamp}</span>
            </div>
          ))}
          {chatLoading && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold animate-pulse">
              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="relative">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={chatLoading}
              placeholder="Ask anything about the forecast..."
              className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:border-violet-500 placeholder-slate-400 font-semibold text-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={chatLoading || !userInput.trim()}
              className="absolute right-2 top-2 p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
