import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { createBot, notifyGroup } from './bot/bot.js';
import db from './db/database.js';
import { createWsServer } from './websocket/wsServer.js';
import apiRoutes from './api/routes.js';
import { startScheduler } from './scheduler.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';

const MINIAPP_URL = process.env.MINIAPP_URL || 'http://localhost:5174';

const allowedOrigins = process.env.NODE_ENV === 'development'
  ? [DASHBOARD_URL, MINIAPP_URL, /localhost:\d+/]
  : [DASHBOARD_URL, MINIAPP_URL];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static('/app/data/uploads'));

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
const NOTIFY_GROUP_ID = process.env.NOTIFY_GROUP_ID;
if (BOT_TOKEN && BOT_TOKEN !== 'your_telegram_bot_token_here') {
  const bot = createBot(BOT_TOKEN);
  bot.start({
    onStart: (info) => {
      console.log(`🤖 Bot @${info.username} started!`);
      if (!NOTIFY_GROUP_ID) {
        console.warn('⚠️  NOTIFY_GROUP_ID non défini — les notifications groupe ne seront PAS envoyées.');
        console.warn('   → Ajoute le bot dans ton groupe, tape /chatid, et mets l\'ID dans backend/.env');
      } else {
        console.log(`📣 Notifications groupe → ${NOTIFY_GROUP_ID}`);
      }
    }
  }).catch(console.error);
} else {
  console.warn('⚠️  No BOT_TOKEN set. Bot will not start. Set BOT_TOKEN in .env');
  try { createBot('placeholder'); } catch (e) {}
}

// Rappel commandes en attente depuis +2h (toutes les 30 min)
setInterval(async () => {
  try {
    const stale = db.prepare(`
      SELECT o.id, u.username, u.first_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status = 'pending' AND o.created_at < datetime('now', '-2 hours')
    `).all();
    if (stale.length > 0) {
      const lines = stale.map(o => {
        const name = o.username ? `@${o.username}` : (o.first_name || `#${o.id}`);
        return `• Commande ${o.id} — ${name}`;
      }).join('\n');
      await notifyGroup(`⏰ <b>Rappel — ${stale.length} commande${stale.length > 1 ? 's' : ''} en attente depuis +2h :</b>\n${lines}`);
    }
  } catch(e) { console.error('reminder error:', e.message); }
}, 30 * 60 * 1000);

// Start automation scheduler
startScheduler();

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
