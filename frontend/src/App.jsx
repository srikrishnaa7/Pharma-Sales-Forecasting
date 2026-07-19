import React, { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Forecasting from './pages/Forecasting';
import DataAnalysis from './pages/DataAnalysis';
import AIChat from './pages/AIChat';
import Products from './pages/Products';

export default function App() {
  const [activePage, setActivePage] = useState('dashboard');

  const renderActivePage = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard />;
      case 'forecasting':
        return <Forecasting />;
      case 'analysis':
        return <DataAnalysis />;
      case 'chat':
        return <AIChat />;
      case 'products':
        return <Products />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout activePage={activePage} setActivePage={setActivePage}>
      {renderActivePage()}
    </Layout>
  );
}
