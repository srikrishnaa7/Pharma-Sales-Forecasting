import axios from 'axios';

const API_BASE_URL = 'https://pharma-sales-forecasting.onrender.com/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
  // Status check
  getStatus: async (granularity = 'daily') => {
    const response = await apiClient.get(`/status?granularity=${granularity}`);
    return response.data;
  },

  // Products
  getProducts: async (granularity = 'daily') => {
    const response = await apiClient.get(`/products?granularity=${granularity}`);
    return response.data;
  },
  
  // Historical sales logs
  getSalesHistory: async (granularity = 'daily') => {
    const response = await apiClient.get(`/sales-history?granularity=${granularity}`);
    return response.data;
  },
  
  // Forecasting & ML
  getForecast: async (category, arg2 = null, arg3 = null, granularity = 'daily') => {
    let url = `/forecast?category=${category}`;
    if (typeof arg2 === 'number') {
      url += `&horizon=${arg2}&granularity=${granularity}`;
    } else {
      url += `&granularity=${granularity}`;
      if (arg2) url += `&start_date=${arg2}`;
      if (arg3) url += `&end_date=${arg3}`;
    }
    const response = await apiClient.get(url);
    return response.data;
  },
  
  // Dynamic predictions (manual)
  predictSingle: async (category, features, granularity = 'daily') => {
    const response = await apiClient.post(`/predict?granularity=${granularity}`, { category, features });
    return response.data;
  },

  // AI Contextual Chat
  getChatHistory: async () => {
    const response = await apiClient.get('/chat/history');
    return response.data;
  },

  clearChatHistory: async () => {
    const response = await apiClient.post('/chat/clear');
    return response.data;
  },

  sendChatMessage: async (message, product, arg3 = null, arg4 = null, granularity = 'daily') => {
    const payload = { message, product };
    if (typeof arg3 === 'number') {
      payload.horizon = arg3;
      payload.granularity = granularity;
    } else {
      payload.start_date = arg3;
      payload.end_date = arg4;
      payload.granularity = granularity;
    }
    const response = await apiClient.post('/chat', payload);
    return response.data;
  },
  
  // Dataset Operations
  getDatasets: async () => {
    const response = await apiClient.get('/datasets');
    return response.data;
  },

  uploadCSV: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
