import { WebSocketServer, WebSocket } from 'ws';

let wss = null;
const adminClients = new Set();

export function createWsServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    adminClients.add(ws);
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleAdminMessage(msg, ws);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    });

    ws.on('close', () => {
      adminClients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WS error:', err);
      adminClients.delete(ws);
    });

    // Send initial ping
    ws.send(JSON.stringify({ type: 'connected', message: 'Dashboard connected' }));
  });

  // Heartbeat
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        adminClients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  return wss;
}

async function handleAdminMessage(msg, ws) {
  if (msg.type === 'send_message') {
    // Dynamic import to avoid circular deps
    const { sendMessageToUser } = await import('../bot/bot.js');
    const db = (await import('../db/database.js')).default;

    const { telegram_id, text, user_id } = msg;
    try {
      await sendMessageToUser(telegram_id, text);

      db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin) VALUES (?, ?, ?, 1)')
        .run(user_id, telegram_id, text);

      broadcastToAdmins({
        type: 'message_sent',
        message: { user_id, telegram_id, text, from_admin: true, created_at: new Date().toISOString() }
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: `Failed to send message: ${err.message}` }));
    }
  }

  if (msg.type === 'update_order_status') {
    const db = (await import('../db/database.js')).default;
    const { order_id, status } = msg;
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, order_id);

    broadcastToAdmins({ type: 'order_updated', order_id, status });

    // Notify user via Telegram
    const { sendMessageToUser } = await import('../bot/bot.js');
    const order = db.prepare(`
      SELECT o.*, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(order_id);

    if (order) {
      const statusMsg = {
        confirmed: '✅ Votre commande a été *confirmée*!',
        preparing: '👨‍🍳 Votre commande est en *préparation*!',
        shipped: '🚚 Votre commande a été *expédiée*!',
        delivered: '📬 Votre commande a été *livrée*! Merci!',
        cancelled: '❌ Votre commande a été *annulée*. Contactez-nous pour plus d\'infos.'
      };
      const message = statusMsg[status];
      if (message) {
        try {
          await sendMessageToUser(order.telegram_id, `${message}\n\n*Commande #${order_id}*`);
        } catch (e) {
          console.error('Failed to notify user:', e);
        }
      }
    }
  }
}

export function broadcastToAdmins(data) {
  const json = JSON.stringify(data);
  adminClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}
