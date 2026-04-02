import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import db from '../db/database.js';
import { broadcastToAdmins } from '../websocket/wsServer.js';

let bot = null;

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || fallback;
}

async function sendToGroup(groupId, text, extra = {}) {
  try {
    await bot.api.sendMessage(groupId, text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    console.error(`sendToGroup(${groupId}) HTML error:`, e.message);
    try {
      await bot.api.sendMessage(groupId, text.replace(/<[^>]+>/g, ''));
    } catch (e2) {
      console.error(`sendToGroup(${groupId}) plain error:`, e2.message);
    }
  }
}

export async function notifyGroup(text, extra = {}) {
  const groupId = process.env.NOTIFY_GROUP_ID;
  if (!bot || !groupId) return;
  await sendToGroup(groupId, text, extra);
}

export async function notifyLogin(text) {
  const groupId = process.env.NOTIFY_LOGIN_GROUP_ID;
  if (!bot) { console.error('notifyLogin: bot not initialized'); return; }
  if (!groupId) { console.error('notifyLogin: NOTIFY_LOGIN_GROUP_ID not set'); return; }
  console.log('notifyLogin: sending to', groupId);
  await sendToGroup(groupId, text);
  console.log('notifyLogin: done');
}

export async function notifyGroupOrder(text, orderId) {
  const groupId = process.env.NOTIFY_GROUP_ID;
  if (!bot || !groupId) return;
  const keyboard = new InlineKeyboard()
    .text('✅ Confirmer', `order_confirm_${orderId}`)
    .text('❌ Annuler', `order_cancel_${orderId}`);
  try {
    await bot.api.sendMessage(groupId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (e) {
    console.error('notifyGroupOrder error:', e.message);
    try {
      await bot.api.sendMessage(groupId, text.replace(/<[^>]+>/g, ''));
    } catch (e2) {
      console.error('notifyGroupOrder plain error:', e2.message);
    }
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
        await notifyGroup(`👤 <b>Nouvel utilisateur</b>\n${name} (${username})`);
      }
    }
    await next();
  });

  // Helper: générer un code de parrainage unique
  function generateReferralCode(telegramId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '', seed = telegramId;
    for (let i = 0; i < 6; i++) { seed = (seed * 1664525 + 1013904223) & 0xffffffff; code += chars[Math.abs(seed) % chars.length]; }
    return code;
  }

  // Helper: s'assurer que l'utilisateur a un code de parrainage
  function ensureReferralCode(userId, telegramId) {
    const user = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
    if (!user?.referral_code) {
      let code = generateReferralCode(telegramId);
      // Garantir l'unicité
      while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
        code = generateReferralCode(telegramId + Math.floor(Math.random() * 9999));
      }
      db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId);
      return code;
    }
    return user.referral_code;
  }

  // /start command
  bot.command('start', async (ctx) => {
    const name = ctx.from.first_name || 'ami';
    const miniappUrl = process.env.MINIAPP_URL || 'http://localhost:5174';
    const shopName = getSetting('shop_name', 'notre boutique');
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);

    if (!user || !user.is_validated) {
      // Compte non validé — demander le code de parrainage
      await ctx.reply(
        `🌿 <b>Bienvenue chez ${shopName}!</b>\n\n` +
        `Bonjour ${name}! 👋\n\n` +
        `⚠️ <b>Accès sur invitation uniquement.</b>\n\n` +
        `Pour accéder à la boutique, entrez le <b>code de parrainage</b> d'un client déjà enregistré :\n\n` +
        `<i>Exemple : A3B7X9</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Compte validé — afficher la boutique
    const code = ensureReferralCode(user.id, ctx.from.id);
    const keyboard = new InlineKeyboard()
      .webApp('🛍️ Ouvrir la boutique', miniappUrl)
      .row()
      .text('📦 Mes commandes', 'my_orders')
      .text('💬 Contacter', 'contact')
      .row()
      .text('🎁 Mon code de parrainage', 'my_referral');

    await ctx.reply(
      `🌿 <b>Bienvenue chez ${shopName}!</b>\n\n` +
      `Bonjour ${name}! 👋\n\n` +
      `Appuyez sur le bouton pour ouvrir la boutique:`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  });

  // Callback — afficher son code de parrainage
  bot.callbackQuery('my_referral', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
    if (!user) return;
    const code = ensureReferralCode(user.id, ctx.from.id);
    const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(user.id)?.c || 0;
    await ctx.reply(
      `🎁 <b>Ton code de parrainage</b>\n\n` +
      `<code>${code}</code>\n\n` +
      `Partage ce code à tes amis pour leur donner accès à la boutique.\n\n` +
      `👥 <b>${count} personne${count>1?'s':''} parrainée${count>1?'s':''}</b>`,
      { parse_mode: 'HTML' }
    );
  });

  // /chatid — show current chat ID (for configuring NOTIFY_GROUP_ID)
  bot.command('chatid', async (ctx) => {
    const id = ctx.chat.id;
    const type = ctx.chat.type;
    await ctx.reply(`Chat ID: <code>${id}</code>\nType: ${type}\n\nCopie cet ID dans backend/.env → NOTIFY_GROUP_ID=${id}`, { parse_mode: 'HTML' });
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
    let text = '📦 <b>Vos dernières commandes</b>\n\n';
    orders.forEach(o => {
      text += `${statusLabel[o.status]||'❓'} <b>#${o.id}</b> — ${o.total?.toFixed(2)}€\n`;
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.callbackQuery('contact', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('💬 Contactez-nous directement sur Telegram :', {
      reply_markup: new InlineKeyboard().url('💬 Écrire à @baltimore_83', 'https://t.me/baltimore_83')
    });
  });

  // Inline order confirm/cancel from group notifications
  bot.callbackQuery(/^order_confirm_(\d+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
      db.prepare("UPDATE orders SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run(orderId);
      const order = db.prepare('SELECT o.*, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?').get(orderId);
      await ctx.answerCallbackQuery('✅ Commande confirmée !');
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`✅ Confirmée par ${ctx.from.first_name || 'admin'}`, 'noop') });
      if (order) {
        sendMessageToUser(order.telegram_id,
          `✅ <b>Bonne nouvelle ! Votre commande #${orderId} est confirmée.</b>\n\nNotre équipe la prépare et vous contactera très bientôt 🚀`
        ).catch(() => {});
      }
    } catch (e) {
      await ctx.answerCallbackQuery('Erreur: ' + e.message);
    }
  });

  bot.callbackQuery(/^order_cancel_(\d+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
      db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(orderId);
      const order = db.prepare('SELECT o.*, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?').get(orderId);
      await ctx.answerCallbackQuery('❌ Commande annulée');
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`❌ Annulée par ${ctx.from.first_name || 'admin'}`, 'noop') });
      if (order) {
        sendMessageToUser(order.telegram_id,
          `❌ <b>Commande #${orderId} annulée.</b>\n\nN'hésitez pas à nous contacter pour plus d'informations.`
        ).catch(() => {});
      }
    } catch (e) {
      await ctx.answerCallbackQuery('Erreur: ' + e.message);
    }
  });

  bot.callbackQuery('noop', async (ctx) => { await ctx.answerCallbackQuery(); });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  // Keyboard button handlers
  bot.hears('📦 Mes Commandes', async (ctx) => { await showOrders(ctx); });
  bot.hears('💬 Contact', async (ctx) => { await showContact(ctx); });
  bot.hears('ℹ️ À propos', async (ctx) => { await showAbout(ctx); });

  // Handle regular text messages
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/') || ['📦 Mes Commandes', '💬 Contact', 'ℹ️ À propos'].includes(text)) return;

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(ctx.from.id);
    const miniappUrl = process.env.MINIAPP_URL || 'http://localhost:5174';
    const shopName = getSetting('shop_name', 'notre boutique');

    // Vérifier si c'est un code de parrainage (6 caractères alphanumériques)
    if (!user?.is_validated && /^[A-Z0-9]{6}$/i.test(text)) {
      const codeUpper = text.toUpperCase();
      const referrer = db.prepare('SELECT * FROM users WHERE referral_code = ? AND is_validated = 1').get(codeUpper);
      if (!referrer) {
        await ctx.reply(
          `❌ <b>Code invalide ou non reconnu.</b>\n\n` +
          `Vérifie le code avec la personne qui t'a invité et réessaie.`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      // Valider le compte
      db.prepare('UPDATE users SET is_validated = 1, referred_by = ? WHERE telegram_id = ?').run(referrer.id, ctx.from.id);
      const name = ctx.from.first_name || 'ami';
      const myCode = ensureReferralCode(user?.id || referrer.id, ctx.from.id);
      const keyboard = new InlineKeyboard()
        .webApp('🛍️ Ouvrir la boutique', miniappUrl)
        .row()
        .text('📦 Mes commandes', 'my_orders')
        .text('💬 Contacter', 'contact')
        .row()
        .text('🎁 Mon code de parrainage', 'my_referral');
      await ctx.reply(
        `✅ <b>Compte validé ! Bienvenue ${name} !</b>\n\n` +
        `Tu as accès à la boutique <b>${shopName}</b>.\n\n` +
        `🎁 Ton code de parrainage pour inviter tes amis :\n<code>${myCode}</code>`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      // Notifier le parrain
      sendMessageToUser(referrer.telegram_id,
        `🎉 <b>Bonne nouvelle !</b>\n${name} a rejoint la boutique grâce à ton parrainage !`
      ).catch(() => {});
      // Notifier l'admin
      await notifyGroup(
        `✅ <b>Nouveau compte validé</b>\n${name} (@${ctx.from.username || ctx.from.id}) parrainé par ${referrer.first_name || referrer.telegram_id}`
      );
      return;
    }

    // Si non validé et pas un code valide
    if (!user?.is_validated) {
      await ctx.reply(
        `⚠️ <b>Compte non activé.</b>\n\n` +
        `Entre le code de parrainage (6 caractères) d'un client déjà enregistré pour accéder à la boutique.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await ctx.reply('💬 Pour nous contacter directement, écrivez-nous sur Telegram :', {
      reply_markup: new InlineKeyboard().url('💬 Écrire à @baltimore_83', 'https://t.me/baltimore_83')
    });
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

  let text = '📦 <b>Vos Commandes</b>\n\n';
  orders.forEach(order => {
    const emoji = statusEmoji[order.status] || '❓';
    const label = statusLabel[order.status] || order.status;
    const date = new Date(order.created_at).toLocaleDateString('fr-FR');
    text += `${emoji} <b>Commande #${order.id}</b> - ${date}\n`;
    text += `   💰 ${order.total.toFixed(2)}€ | ${order.item_count} article(s) | ${label}\n\n`;
  });

  await ctx.reply(text, { parse_mode: 'HTML' });
}

async function showContact(ctx) {
  await ctx.reply(
    '💬 <b>Contactez-nous</b>\n\n' +
    'Écrivez-nous directement ici, notre équipe vous répond rapidement!\n\n' +
    '🕐 Horaires: 10h-23h',
    { parse_mode: 'HTML' }
  );
}

async function showAbout(ctx) {
  const shopName = getSetting('shop_name', 'Notre boutique');
  const tagline = getSetting('shop_tagline', '');
  await ctx.reply(
    `ℹ️ <b>${shopName}</b>\n\n` +
    (tagline ? `${tagline}\n\n` : '') +
    '🚚 Livraison rapide\n' +
    '💰 Meilleurs prix\n' +
    '✅ Qualité garantie',
    { parse_mode: 'HTML' }
  );
}

export async function sendMessageToUser(telegramId, text) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(telegramId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('sendMessageToUser error:', e.message);
    try { await bot.api.sendMessage(telegramId, text.replace(/<[^>]+>/g, '')); } catch {}
  }
}
