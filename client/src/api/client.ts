import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('clawbot_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('clawbot_token');
      localStorage.removeItem('clawbot_user');
      if (window.location.pathname !== '/login') {
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);
