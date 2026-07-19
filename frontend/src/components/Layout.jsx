import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  TrendingUp, 
  BarChart3, 
  MessageSquare,
  Sun, 
  Moon, 
  Menu,
  Sparkles,
  RefreshCcw,
  ShoppingCart
} from 'lucide-react';
import { api } from '../services/api';

export default function Layout({ children, activePage, setActivePage }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });
  const [status, setStatus] = useState({ is_training: false, progress: 'Idle', active_dataset: 'Loading...' });
  const [datasets, setDatasets] = useState([]);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // Poll status occasionally to show global retraining loader
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await api.getStatus('daily');
        setStatus(data);
      } catch (e) {
        console.error(e);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const navigation = [
    { name: 'Dashboard', icon: LayoutDashboard, id: 'dashboard' },
    { name: 'Forecast Studio', icon: TrendingUp, id: 'forecasting' },
    { name: 'Product Catalog', icon: ShoppingCart, id: 'products' },
    { name: 'Data Analysis (EDA)', icon: BarChart3, id: 'analysis' },
    { name: 'AI Forecast Chat', icon: MessageSquare, id: 'chat' },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex flex-col ${sidebarOpen ? 'w-64' : 'w-20'}`}>
        {/* Brand Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 shadow-lg shadow-violet-500/30">
              P
            </div>
            {sidebarOpen && (
              <span className="font-extrabold text-lg bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400 bg-clip-text text-transparent tracking-tight whitespace-nowrap">
                Pharma sales forecaster
              </span>
            )}
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-4 px-3 py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
                  isActive 
                    ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/10'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                {sidebarOpen && <span className="truncate">{item.name}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-center">
          {sidebarOpen && (
            <span className="text-[10px] text-slate-400 font-bold uppercase leading-none">Pharma sales forecaster Forecast Studio</span>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? 'pl-64' : 'pl-20'}`}>
        {/* Top Header */}
        <header className="h-16 sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-bold text-lg text-slate-900 dark:text-white capitalize">
              {navigation.find(n => n.id === activePage)?.name || activePage}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Theme & User Profile spacer */}

            {/* Model Retraining Status Bar */}
            {status.is_training && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900 rounded-xl text-[10px] font-bold text-violet-700 dark:text-violet-400 animate-pulse">
                <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                <span>AI Pipeline Training...</span>
              </div>
            )}

            {/* Dark Mode Toggle */}
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
              title="Toggle Theme"
            >
              {darkMode ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-slate-600" />}
            </button>
          </div>
        </header>

        {/* Content Children wrapper */}
        <main className="flex-1 p-8 overflow-y-auto">
          {!status.is_training && (
            <div>
              {children}
            </div>
          )}
        </main>
      </div>

      {/* Full-screen Loading Overlay for Retraining */}
      {status.is_training && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-md text-white">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center max-w-sm mx-4">
            <div className="w-16 h-16 rounded-full border-4 border-violet-100 border-t-violet-600 animate-spin mb-6"></div>
            <h3 className="text-lg font-black text-slate-950 dark:text-white mb-2">Re-training AI Models</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mb-4">
              Optimizing predictive parameters for <span className="text-violet-600 dark:text-violet-400 font-bold">{status.active_dataset}</span>
            </p>
            <div className="w-full px-4 py-2.5 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900 rounded-xl text-xs font-bold text-violet-700 dark:text-violet-400 animate-pulse">
              {status.progress}
            </div>
            <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">
              Prophet and Random Forest ensembles are learning trend seasonality patterns. Please wait...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
