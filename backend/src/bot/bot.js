import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import db from '../db/database.js';
import { broadcastToAdmins } from '../websocket/wsServer.js';

let bot = null;

export async function notifyGroup(text) {
  const groupId = process.env.NOTIFY_GROUP_ID;
  if (!bot || !groupId) return;
  try {
    await bot.api.sendMessage(groupId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyGroup error:', e.message);
  }
}

export function createBot(token) {
  bot = new Bot(token);

  // Middleware: upsert user on every message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      const isNew = !db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(ctx.from.id);
      db.prepare(`
        INSERT INTO users (telegram_id, username, first_name, last_name, last_seen)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          last_seen = datetime('now')
      `).run(
        ctx.from.id,
        ctx.from.username || null,
        ctx.from.first_name || null,
        ctx.from.last_name || null
      );
      if (isNew) {
        const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Inconnu';
        const username = ctx.from.username ? `@${ctx.from.username}` : `#${ctx.from.id}`;
        await notifyGroup(`👤 *Nouvel utilisateur*\n${name} (${username})`);
      }
    }
    await next();
  });

  // /start command — opens mini app
  bot.command('start', async (ctx) => {
    const name = ctx.from.first_name || 'ami';
    const miniappUrl = process.env.MINIAPP_URL || 'http://localhost:5174';
    const keyboard = new InlineKeyboard()
      .webApp('🛍️ Ouvrir la boutique', miniappUrl)
      .row()
      .text('📦 Mes commandes', 'my_orders')
      .text('💬 Contacter', 'contact');

    await ctx.reply(
      `🌿 *Bienvenue chez CBD Shop!*\n\n` +
      `Bonjour ${name}! 👋\n\n` +
      `Découvrez notre sélection premium de produits CBD.\n` +
      `Tous légaux (< 0.3% THC) et testés en laboratoire. 🧪\n\n` +
      `Appuyez sur le bouton pour ouvrir notre boutique:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // /shop command
  bot.command('shop', async (ctx) => {
    const miniappUrl = process.env.MINIAPP_URL || 'http://localhost:5174';
    await ctx.reply('🛍️ Ouvrez notre boutique :', {
      reply_markup: new InlineKeyboard().webApp('🛍️ CBD Shop', miniappUrl)
    });
  });

  // Inline callbacks
  bot.callbackQuery('my_orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
    if (!user) { await ctx.reply('Aucune commande trouvée.'); return; }
    const orders = db.prepare(`
      SELECT o.*, COUNT(oi.id) as item_count FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = ? GROUP BY o.id ORDER BY o.created_at DESC LIMIT 5
    `).all(user.id);
    if (!orders.length) { await ctx.reply('📦 Vous n\'avez pas encore de commandes.'); return; }
    const statusLabel = { pending:'⏳ En attente', confirmed:'✅ Confirmée', preparing:'👨‍🍳 Préparation', shipped:'🚚 Expédiée', delivered:'📬 Livrée', cancelled:'❌ Annulée' };
    let text = '📦 *Vos dernières commandes*\n\n';
    orders.forEach(o => {
      text += `${statusLabel[o.status]||'❓'} *#${o.id}* — ${o.total?.toFixed(2)}€\n`;
    });
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.callbackQuery('contact', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('💬 Écrivez-nous directement ici, notre équipe vous répond rapidement!\n\n📍 12 Rue des Fleurs, Paris\n🕐 Lun-Sam 10h-19h');
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  // Keyboard button handlers
  bot.hears('📦 Mes Commandes', async (ctx) => { await showOrders(ctx); });
  bot.hears('💬 Contact', async (ctx) => { await showContact(ctx); });
  bot.hears('ℹ️ À propos', async (ctx) => { await showAbout(ctx); });

  // Handle regular text messages
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || ['📦 Mes Commandes', '💬 Contact', 'ℹ️ À propos'].includes(text)) return;

    // Save message and notify admin
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
    if (user) {
      db.prepare('INSERT INTO messages (user_id, telegram_id, text, from_admin) VALUES (?, ?, ?, 0)')
        .run(user.id, ctx.from.id, text);
      broadcastToAdmins({
        type: 'new_message',
        message: {
          user_id: user.id,
          telegram_id: ctx.from.id,
          username: user.username,
          first_name: user.first_name,
          text,
          from_admin: false,
          created_at: new Date().toISOString()
        }
      });
    }

    await ctx.reply('💬 Votre message a été transmis à notre équipe. Nous vous répondrons rapidement!');
  });

  return bot;
}

export function getBotInstance() {
  return bot;
}

async function showOrders(ctx) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
  if (!user) {
    await ctx.reply('Aucune commande trouvée.');
    return;
  }

  const orders = db.prepare(`
    SELECT o.*, COUNT(oi.id) as item_count
    FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = ?
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 10
  `).all(user.id);

  if (!orders.length) {
    await ctx.reply('📦 Vous n\'avez pas encore de commandes.\n\nOuvrez notre boutique pour commander! 🛍️');
    return;
  }

  const statusEmoji = {
    pending: '⏳', confirmed: '✅', preparing: '👨‍🍳',
    shipped: '🚚', delivered: '📬', cancelled: '❌'
  };
  const statusLabel = {
    pending: 'En attente', confirmed: 'Confirmée', preparing: 'En préparation',
    shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée'
  };

  let text = '📦 *Vos Commandes*\n\n';
  orders.forEach(order => {
    const emoji = statusEmoji[order.status] || '❓';
    const label = statusLabel[order.status] || order.status;
    const date = new Date(order.created_at).toLocaleDateString('fr-FR');
    text += `${emoji} *Commande #${order.id}* - ${date}\n`;
    text += `   💰 ${order.total.toFixed(2)}€ | ${order.item_count} article(s) | ${label}\n\n`;
  });

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

async function showContact(ctx) {
  await ctx.reply(
    '💬 *Contactez-nous*\n\n' +
    'Vous pouvez nous écrire directement ici et notre équipe vous répondra!\n\n' +
    '📍 Adresse: 12 Rue des Fleurs, Paris\n' +
    '📞 Tel: +33 1 23 45 67 89\n' +
    '🕐 Horaires: Lun-Sam 10h-19h\n\n' +
    'Tapez votre message ci-dessous:',
    { parse_mode: 'Markdown' }
  );
}

async function showAbout(ctx) {
  await ctx.reply(
    'ℹ️ *À propos de CBD Shop*\n\n' +
    '🌿 Votre spécialiste CBD depuis 2020\n\n' +
    'Tous nos produits sont:\n' +
    '✅ Légaux (< 0.3% THC)\n' +
    '✅ Testés en laboratoire\n' +
    '✅ D\'origine UE\n' +
    '✅ 100% naturels\n\n' +
    '_Nos produits ne sont pas des médicaments et ne remplacent pas un avis médical._',
    { parse_mode: 'Markdown' }
  );
}

export async function sendMessageToUser(telegramId, text) {
  if (!bot) return;
  await bot.api.sendMessage(telegramId, text, { parse_mode: 'Markdown' });
}
