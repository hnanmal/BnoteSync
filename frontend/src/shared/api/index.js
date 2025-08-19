import axios from "axios";
const base = import.meta.env.VITE_API_BASE || "http://localhost:8000";
// export const api = axios.create({
//   baseURL: `${base}/api`,
//   withCredentials: false,
// });

const DEV_BASE = "http://127.0.0.1:8000/api";
const PROD_BASE = "/api";
export const api = axios.create({
  baseURL: import.meta.env.DEV ? DEV_BASE : PROD_BASE,
});