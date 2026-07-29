// Centralized API configuration
// Uses NEXT_PUBLIC_API_URL from .env.local (defaults to localhost for dev)
const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default API_BASE_URL;
