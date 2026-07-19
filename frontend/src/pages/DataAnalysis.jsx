import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { HelpCircle, BarChart2, Calendar, FileText, Percent, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e'];

export default function DataAnalysis() {
  const [history, setHistory] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Active EDA Tab
  const [activeTab, setActiveTab] = useState('ranking');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const histData = await api.getSalesHistory();
      setHistory(histData);
      
      const prodData = await api.getProducts();
      setProducts(prodData);
    } catch (err) {
      console.error(err);
      setError('Could not connect to backend. Verify FastAPI server is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin"></div>
        <p className="text-slate-500 font-semibold text-sm animate-pulse">Running Principal Component Analysis...</p>
      </div>
    );
  }

  if (error || history.length === 0 || products.length === 0) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 rounded-3xl">
        <p className="font-bold">Error compiling EDA data</p>
        <p className="text-xs mt-1">{error || 'Verify model training status.'}</p>
        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold transition-all">Retry</button>
      </div>
    );
  }

  const formatNumber = (val) => new Intl.NumberFormat('en-US').format(val);

  // 1. Calculate Correlation Matrix (Pearson approximation on the client side)
  const calculateCorrelation = () => {
    const codes = products.map(p => p.code);
    const n = history.length;
    
    // Compute means
    const means = {};
    codes.forEach(c => {
      means[c] = history.reduce((sum, row) => sum + (row[c] || 0), 0) / n;
    });
    
    // Compute deviations & variance
    const devs = {};
    const stdDevs = {};
    codes.forEach(c => {
      devs[c] = history.map(row => (row[c] || 0) - means[c]);
      const variance = devs[c].reduce((sum, d) => sum + d * d, 0);
      stdDevs[c] = Math.sqrt(variance);
    });
    
    // Compute correlation matrix
    const matrix = [];
    codes.forEach(c1 => {
      const row = { category: c1 };
      codes.forEach(c2 => {
        let cov = 0;
        for (let i = 0; i < n; i++) {
          cov += devs[c1][i] * devs[c2][i];
        }
        const denom = stdDevs[c1] * stdDevs[c2];
        row[c2] = denom > 0 ? cov / denom : 0;
      });
      matrix.push(row);
    });
    
    return { codes, matrix };
  };

  const { codes: corrCodes, matrix: corrMatrix } = calculateCorrelation();

  // Helper to color heatmap cells based on correlation coeff (-1 to 1)
  const getCellColor = (coeff) => {
    // Coeff from -1 (red) to 0 (white) to 1 (blue/violet)
    const absVal = Math.abs(coeff);
    const intensity = Math.round(absVal * 255);
    
    if (coeff >= 0) {
      // Fade from white (255, 255, 255) to Indigo-violet (139, 92, 246)
      const r = 255 - Math.round(absVal * (255 - 139));
      const g = 255 - Math.round(absVal * (255 - 92));
      const b = 255 - Math.round(absVal * (255 - 246));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Fade from white to Rose-red (244, 63, 94)
      const r = 255 - Math.round(absVal * (255 - 244));
      const g = 255 - Math.round(absVal * (255 - 63));
      const b = 255 - Math.round(absVal * (255 - 94));
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  // 2. Sales distribution (histogram mockup bins)
  const getSalesDistribution = () => {
    // Select first active product to plot distribution
    const firstProd = products[0].code;
    const values = history.map(row => row[firstProd]).sort((a, b) => a - b);
    const minVal = values[0];
    const maxVal = values[values.length - 1];
    
    const binCount = 10;
    const binWidth = (maxVal - minVal) / binCount;
    
    const bins = Array.from({ length: binCount }, (_, idx) => {
      const start = minVal + idx * binWidth;
      const end = start + binWidth;
      return {
        binLabel: `[${start.toFixed(0)}-${end.toFixed(0)}]`,
        frequency: 0
      };
    });
    
    values.forEach(val => {
      const binIdx = Math.min(binCount - 1, Math.floor((val - minVal) / binWidth));
      if (bins[binIdx]) bins[binIdx].frequency++;
    });
    
    return { productName: firstProd, bins };
  };

  const { productName: distProd, bins: distBins } = getSalesDistribution();

  // 3. Seasonal Trends (Day of Week and Monthly Peaks)
  // Aggregate sales by day of week index (from history)
  const getDayOfWeekSales = () => {
    // Average daily sales by category
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const codes = products.map(p => p.code);
    
    const dayAgg = Array.from({ length: 7 }, (_, i) => {
      const row = { day: days[i] };
      codes.forEach(c => { row[c] = 0; });
      row.count = 0;
      return row;
    });

    history.forEach(row => {
      const dt = new Date(row.datum);
      const dayIdx = (dt.getDay() + 6) % 7; // Convert Sun-Sat(0-6) to Mon-Sun(0-6)
      if (dayAgg[dayIdx]) {
        codes.forEach(c => {
          dayAgg[dayIdx][c] += row[c] || 0;
        });
        dayAgg[dayIdx].count++;
      }
    });

    dayAgg.forEach(row => {
      if (row.count > 0) {
        codes.forEach(c => {
          row[c] = Number((row[c] / row.count).toFixed(2));
        });
      }
      row.total = codes.reduce((sum, c) => sum + row[c], 0);
    });

    return dayAgg;
  };

  const dayOfWeekData = getDayOfWeekSales();

  return (
    <div className="space-y-8">
      {/* Sub navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400">
        {[
          { id: 'ranking', label: 'Product Volumes' },
          { id: 'distribution', label: 'Sales Distributions' },
          { id: 'seasonality', label: 'Seasonal Peaks' },
          { id: 'correlation', label: 'Correlation Heatmap' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-4 px-6 border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-violet-600 text-violet-600 dark:text-violet-400 font-extrabold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      {activeTab === 'ranking' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider mb-6">Total Sales Volume by Medicine Class</h3>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={products}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="code" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip formatter={(val) => [formatNumber(val) + " units"]} />
                  <Bar dataKey="total_sold" radius={[8, 8, 0, 0]}>
                    {products.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
              <h4 className="font-extrabold text-xs uppercase text-slate-400 tracking-wider mb-3">Top Selling Categories</h4>
              <ol className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-bold">
                {[...products].sort((a, b) => b.total_sold - a.total_sold).slice(0, 3).map((p, i) => (
                  <li key={p.code} className="py-3 flex items-center justify-between">
                    <span className="text-slate-900 dark:text-white">{i+1}. {p.code} ({p.name})</span>
                    <span className="text-violet-600 dark:text-violet-400">{formatNumber(p.total_sold)} units</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
              <h4 className="font-extrabold text-xs uppercase text-slate-400 tracking-wider mb-3">Lowest Selling Categories</h4>
              <ol className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-bold">
                {[...products].sort((a, b) => a.total_sold - b.total_sold).slice(0, 3).map((p, i) => (
                  <li key={p.code} className="py-3 flex items-center justify-between">
                    <span className="text-slate-900 dark:text-white">{i+1}. {p.code} ({p.name})</span>
                    <span className="text-rose-500">{formatNumber(p.total_sold)} units</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'distribution' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider mb-2">Sales Distribution Histogram</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 font-semibold">
            Visualizing frequency bins for product group **{distProd}** to analyze skewness.
          </p>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distBins}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="binLabel" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip formatter={(v) => [v + " occurrences"]} />
                <Bar dataKey="frequency" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'seasonality' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider mb-6">Average Period Sales by Day of Week</h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dayOfWeekData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip formatter={(v) => [v.toFixed(2) + " units"]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                {products.slice(0, 4).map((p, idx) => (
                  <Line key={p.code} type="monotone" dataKey={p.code} stroke={COLORS[idx]} strokeWidth={2.5} dot={true} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'correlation' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider mb-2">Correlation Matrix Heatmap</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 font-semibold">
            Correlation coefficients (Pearson r) between medicine classifications. Dark violet denotes high correlation, rose indicates negative correlation.
          </p>

          <div className="overflow-x-auto">
            <div className="min-w-[600px] flex items-center justify-center p-4">
              <table className="border-collapse text-[10px] font-bold">
                <thead>
                  <tr>
                    <th className="p-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-950 dark:text-white"></th>
                    {corrCodes.map(code => (
                      <th key={code} className="p-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-950 dark:text-white text-center w-16 truncate">{code}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corrMatrix.map(row => (
                    <tr key={row.category}>
                      <td className="p-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-950 dark:text-white w-16 font-extrabold">{row.category}</td>
                      {corrCodes.map(code => {
                        const coeff = row[code];
                        return (
                          <td 
                            key={code} 
                            style={{ backgroundColor: getCellColor(coeff) }}
                            className="p-3 border border-slate-200 dark:border-slate-800 text-center select-none text-slate-900"
                            title={`Correlation between ${row.category} and ${code}: ${coeff.toFixed(4)}`}
                          >
                            {coeff.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
