import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, RefreshCcw, HelpCircle, MessageSquare, AlertCircle } from 'lucide-react';
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

const SUGGESTED_QUESTIONS = [
  "Which product has the highest historical sales volume?",
  "What is the forecasted sales trend for product M01AB over 90 days?",
  "Are there any significant seasonal dips predicted for paracetamol (N02BE)?",
  "Compare predicted demand between N02BA and N05B."
];

const parseMarkdown = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let currentList = [];
  let listType = null; // 'ul' or 'ol'
  let currentTable = null;

  const renderInline = (str) => {
    const parts = [];
    const regex = /(\*\*|`)(.*?)\1/g;
    let match;
    let lastIndex = 0;
    
    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parts.push(str.substring(lastIndex, match.index));
      }
      const delimiter = match[1];
      const content = match[2];
      if (delimiter === '**') {
        parts.push(<strong key={match.index} className="font-extrabold text-slate-950 dark:text-white">{content}</strong>);
      } else if (delimiter === '`') {
        parts.push(<code key={match.index} className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px] font-mono text-pink-600 dark:text-pink-400 border border-slate-200 dark:border-slate-700">{content}</code>);
      }
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < str.length) {
      parts.push(str.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : str;
  };

  const flushList = () => {
    if (currentList.length > 0) {
      const Tag = listType === 'ol' ? 'ol' : 'ul';
      const className = listType === 'ol' 
        ? "list-decimal pl-5 my-2 space-y-1.5 text-slate-700 dark:text-slate-350"
        : "list-disc pl-5 my-2 space-y-1.5 text-slate-700 dark:text-slate-350";
      elements.push(
        <Tag key={`list-${elements.length}`} className={className}>
          {currentList.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
      currentList = [];
      listType = null;
    }
  };

  const flushTable = () => {
    if (currentTable) {
      elements.push(
        <div key={`table-wrapper-${elements.length}`} className="overflow-x-auto my-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-full">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {currentTable.headers.map((h, idx) => (
                  <th key={idx} className="px-3.5 py-2 text-left font-extrabold text-slate-700 dark:text-slate-350 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-800/50">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              {currentTable.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-slate-600 dark:text-slate-300">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      currentTable = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // 1. Table formatting
    if (line.startsWith('|')) {
      flushList();
      const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      const isSeparator = cells.every(c => /^:-*|-+:*|:-+:$/.test(c) || c === '');
      
      if (isSeparator) {
        continue;
      }
      
      if (!currentTable) {
        currentTable = { headers: cells, rows: [] };
      } else {
        currentTable.rows.push(cells);
      }
      continue;
    } else {
      flushTable();
    }

    // 2. Heading formatting
    if (line.startsWith('#')) {
      flushList();
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const textContent = match[2];
        const headingClass = level === 1 
          ? "text-base font-black text-slate-950 dark:text-white mt-4 mb-2"
          : level === 2
          ? "text-sm font-extrabold text-slate-950 dark:text-white mt-3.5 mb-2"
          : "text-xs font-extrabold text-slate-950 dark:text-white mt-3 mb-1.5";
        const HeadingTag = `h${Math.min(level, 6)}`;
        elements.push(
          React.createElement(HeadingTag, { key: i, className: headingClass }, renderInline(textContent))
        );
        continue;
      }
    }

    // 3. List formatting
    const ulMatch = line.match(/^[\*\-\+]\s+(.*)$/);
    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);

    if (ulMatch) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      currentList.push(ulMatch[1]);
      continue;
    } else if (olMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      currentList.push(olMatch[2]);
      continue;
    } else {
      flushList();
    }

    // 4. Paragraph or line break formatting
    if (line === '') {
      continue;
    }

    elements.push(
      <p key={i} className="mb-2 last:mb-0 text-slate-700 dark:text-slate-350 font-medium">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  flushTable();

  return <div className="space-y-1.5 text-xs">{elements}</div>;
};

export default function AIChat() {
  const [product, setProduct] = useState("M01AB");
  const [targetDate, setTargetDate] = useState("");
  const [minDate, setMinDate] = useState("");
  const [datasetStatus, setDatasetStatus] = useState(null);
  const [horizon, setHorizon] = useState(90);
  
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Welcome to Pharma sales forecaster AI. Ask me about trends, forecasts, peaks, and seasonal behaviors. I pull real sales stats to formulate context-aware responses.', timestamp: '' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  const handleClearChat = async () => {
    try {
      await api.clearChatHistory();
      setMessages([
        { role: 'assistant', content: 'Welcome to Pharma sales forecaster AI. Ask me about trends, forecasts, peaks, and seasonal behaviors. I pull real sales stats to formulate context-aware responses.', timestamp: '' }
      ]);
    } catch (e) {
      console.error("Failed to clear chat history:", e);
    }
  };

  useEffect(() => {
    handleClearChat();

    const initStatus = async () => {
      try {
        const stat = await api.getStatus();
        setDatasetStatus(stat);
        
        const computedMinDate = getMinDateStr(stat.last_historical_date);
        setMinDate(computedMinDate);
        
        const initialTarget = getDefaultTargetDate(stat.last_historical_date, stat.granularity);
        setTargetDate(initialTarget);
        
        const steps = calculateSteps(stat.last_historical_date, initialTarget, stat.granularity);
        setHorizon(steps);
      } catch (err) {
        console.error("Failed to load status in Chat:", err);
      }
    };
    initStatus();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (textToSend) => {
    const userMsg = textToSend || input;
    if (!userMsg.trim()) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: time }]);
    setInput('');
    setLoading(true);

    try {
      const steps = calculateSteps(datasetStatus?.last_historical_date, targetDate, datasetStatus?.granularity);
      const res = await api.sendChatMessage(userMsg, product, steps);
      setMessages(prev => [...prev, { role: 'assistant', content: res.response, timestamp: time }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection timed out. Check your Gemini API key details.', timestamp: time }]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickQuestion = (question) => {
    handleSend(question);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start max-w-6xl mx-auto h-[78vh]">
      {/* Left Column - Filter Adjusters (1/4 width) */}
      <div className="lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl space-y-6 shadow-sm">
        <div>
          <h3 className="font-extrabold text-sm text-slate-950 dark:text-white mb-2">Context Scope Filters</h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
            Changing these filters changes the context metrics injected into the AI's prompts, allowing you to ask focused questions.
          </p>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Target Product</label>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none text-slate-800 dark:text-slate-100"
          >
            {PRODUCT_LIST.map(p => (
              <option key={p} value={p}>{p} Sales Class</option>
            ))}
          </select>
        </div>

        <div>
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
            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold focus:outline-none text-slate-800 dark:text-slate-100"
          />
        </div>

        {/* Suggestion Prompts */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Prompts</span>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => handleQuickQuestion(q)}
                className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-violet-50 dark:hover:bg-violet-950/20 border border-slate-200/50 dark:border-slate-700/50 hover:border-violet-300 dark:hover:border-violet-900 text-[10px] text-slate-600 dark:text-slate-400 font-bold transition-all"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Columns - Dedicated Conversation UI (3/4 width) */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl h-full flex flex-col overflow-hidden shadow-sm">
        {/* Chat Log Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-violet-600 animate-pulse" />
            <div>
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Conversational Analyst Terminal</h3>
              <p className="text-[10px] text-slate-400 font-semibold leading-none mt-1">Direct context injection from active forecasts</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all shadow-sm"
            title="Clear Conversation"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            <span>Clear Chat</span>
          </button>
        </div>

        {/* Scrollable conversation logs */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-semibold leading-relaxed">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-4 rounded-2xl max-w-[85%] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none shadow-md shadow-violet-600/10'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-250 rounded-tl-none border border-slate-200/40 dark:border-slate-700/40'
              }`}>
                {msg.role === 'user' ? msg.content : parseMarkdown(msg.content)}
              </div>
              <span className="text-[9px] text-slate-400 mt-1.5 font-bold pl-1 pr-1">{msg.timestamp}</span>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold animate-pulse pl-1">
              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing forecasting layers...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Action input panel */}
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }} 
          className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              placeholder="Query sales datasets, peaks, variations, and predicted lines..."
              className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:border-violet-500 placeholder-slate-400 font-semibold text-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute right-2.5 p-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
