import dotenv from 'dotenv';
dotenv.config();

export const PORT = Number(process.env.PORT) || 3001;
export const JWT_SECRET = process.env.JWT_SECRET || 'clawbot-agent-jwt-super-secret-key-2026';
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
