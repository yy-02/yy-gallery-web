import axios from 'axios'

// API 基础地址
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://yy-gallery-api.im-yiyin-2002.workers.dev'

// 创建 axios 实例
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
})
