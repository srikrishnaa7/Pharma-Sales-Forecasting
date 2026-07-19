import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, AlertCircle, ShoppingCart, HelpCircle } from 'lucide-react';
import { api } from '../services/api';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('total_sold');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const fetchProducts = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getProducts();
      setProducts(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load products list. Ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin"></div>
        <p className="text-slate-500 font-semibold text-sm">Aggregating Inventory Metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400">
        <p className="font-bold">Catalog Load Error</p>
        <p className="text-xs mt-1">{error}</p>
        <button onClick={fetchProducts} className="mt-4 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold">Retry</button>
      </div>
    );
  }

  // Filter & Search Logic
  const filteredProducts = products.filter(p => 
    p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sorting Logic
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    
    if (typeof valA === 'string') {
      return sortOrder === 'asc' 
        ? valA.localeCompare(valB) 
        : valB.localeCompare(valA);
    } else {
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    }
  });

  // Pagination Logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedProducts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(sortedProducts.length / itemsPerPage);

  const formatNumber = (val) => new Intl.NumberFormat('en-US').format(val);
  const formatDecimal = (val) => Number(val).toFixed(2);

  // Sort indicator helper
  const renderSortIcon = (field) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-8">
      {/* Search and Filters Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            placeholder="Search ATC code or classification..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:border-violet-500 font-semibold text-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="text-xs font-bold text-slate-400">
          Showing {sortedProducts.length} unique pharmaceutical drug classes
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-semibold whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 text-slate-400">
                <th onClick={() => handleSort('code')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white">
                  <div className="flex items-center gap-1">ATC Code {renderSortIcon('code')}</div>
                </th>
                <th onClick={() => handleSort('name')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white">
                  <div className="flex items-center gap-1">Therapeutic Classification {renderSortIcon('name')}</div>
                </th>
                <th onClick={() => handleSort('total_sold')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white text-right">
                  <div className="flex items-center gap-1 justify-end">Total Sold (Units) {renderSortIcon('total_sold')}</div>
                </th>
                <th onClick={() => handleSort('daily_avg')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white text-right">
                  <div className="flex items-center gap-1 justify-end">Average / Period {renderSortIcon('daily_avg')}</div>
                </th>
                <th onClick={() => handleSort('max_sold')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white text-right">
                  <div className="flex items-center gap-1 justify-end">Max Record {renderSortIcon('max_sold')}</div>
                </th>
                <th onClick={() => handleSort('model_r2')} className="py-4 px-6 cursor-pointer hover:text-slate-700 dark:hover:text-white text-right">
                  <div className="flex items-center gap-1 justify-end">Model Predictability ($R^2$) {renderSortIcon('model_r2')}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {currentItems.length > 0 ? (
                currentItems.map((prod) => (
                  <tr key={prod.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="py-4 px-6">
                      <span className="inline-block px-2.5 py-1 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 rounded-lg font-bold text-xs uppercase">
                        {prod.code}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-slate-900 dark:text-white font-bold max-w-xs truncate">{prod.name}</td>
                    <td className="py-4 px-6 text-right font-black text-slate-900 dark:text-white">{formatNumber(prod.total_sold)}</td>
                    <td className="py-4 px-6 text-right">{formatDecimal(prod.daily_avg)}</td>
                    <td className="py-4 px-6 text-right">{formatDecimal(prod.max_sold)}</td>
                    <td className="py-4 px-6 text-right font-black text-emerald-600 dark:text-emerald-400">
                      {(prod.model_r2 * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No pharmaceutical classes match your search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Panel */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-50"
            >
              Previous
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-bold">
              Page {currentPage} of {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
