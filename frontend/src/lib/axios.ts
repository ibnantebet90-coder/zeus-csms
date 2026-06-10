import axios from "axios";
import Cookies from "js-cookie";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
});

// Inject JWT token ke setiap request
api.interceptors.request.use((config) => {
  const token = Cookies.get("zeus_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto redirect ke login jika token expired/invalid
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const isLoginPage = window.location.pathname === "/login";
      if (!isLoginPage) {
        Cookies.remove("zeus_token");
        Cookies.remove("zeus_role");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;