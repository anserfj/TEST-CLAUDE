import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { createBot } from './bot/bot.js';
import { createWsServer } from './websocket/wsServer.js';
import apiRoutes from './api/routes.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';

const MINIAPP_URL = process.env.MINIAPP_URL || 'http://localhost:5174';

app.use(cors({ origin: [DASHBOARD_URL, MINIAPP_URL, /localhost:\d+/] }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API routes
app.use('/api', apiRoutes);

// Create HTTP server (shared with WebSocket)
const server = http.createServer(app);

// WebSocket server
createWsServer(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket available on ws://localhost:${PORT}/ws`);
});

// Start Telegram bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN && BOT_TOKEN !== 'your_telegram_bot_token_here') {
  const bot = createBot(BOT_TOKEN);
  bot.start({
    onStart: (info) => console.log(`🤖 Bot @${info.username} started!`)
  }).catch(console.error);
} else {
  console.warn('⚠️  No BOT_TOKEN set. Bot will not start. Set BOT_TOKEN in .env');
  // Still create bot instance for API calls (will fail gracefully)
  try { createBot('placeholder'); } catch (e) {}
}

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
