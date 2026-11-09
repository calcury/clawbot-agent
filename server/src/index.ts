import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { PORT } from './config/env.js';
import { initDatabase } from './config/database.js';
import { router as apiRouter } from './routes/api.js';
import { startReminderScheduler } from './services/reminder.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
initDatabase();

// Mount API routes
app.use('/api', apiRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend if built (for production or standalone deployment)
const clientDistPath = path.resolve(process.cwd(), 'client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Start Background Reminder & Calendar Sync
startReminderScheduler();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Server] Clawbot Agent Backend is running on http://localhost:${PORT}`);
  console.log(`🌐 [Frontend] Management dashboard runs on port 5178 via Vite dev or built assets`);
});
