import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import db from '../db/database.js';
import { broadcastToAdmins } from '../websocket/wsServer.js';

let bot = null;

export function createBot(token) {
  bot = new Bot(token);

  // Middleware: upsert user on every message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
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

  // Shop button shortcut
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

  // Legacy inline callbacks (kept for backward compat)
  bot.callbackQuery(/^cat_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const catId = parseInt(ctx.match[1]);
    await showProducts(ctx, catId);
  });

  bot.callbackQuery(/^prod_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const prodId = parseInt(ctx.match[1]);
    await showProductDetail(ctx, prodId);
  });

  bot.callbackQuery(/^addcart_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('✅ Ajouté au panier!');
    const prodId = parseInt(ctx.match[1]);
    const qty = parseInt(ctx.match[2]);
    addToCart(ctx.from.id, prodId, qty);
    await ctx.reply('✅ Produit ajouté au panier!\n\nTapez 🛒 *Mon Panier* pour voir votre panier.', {
      parse_mode: 'Markdown'
    });
  });

  bot.callbackQuery(/^removecart_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const prodId = parseInt(ctx.match[1]);
    db.prepare('DELETE FROM carts WHERE telegram_id = ? AND product_id = ?')
      .run(ctx.from.id, prodId);
    await showCart(ctx);
  });

  bot.callbackQuery('checkout', async (ctx) => {
    await ctx.answerCallbackQuery();
    await processCheckout(ctx);
  });

  bot.callbackQuery('clearcart', async (ctx) => {
    await ctx.answerCallbackQuery();
    db.prepare('DELETE FROM carts WHERE telegram_id = ?').run(ctx.from.id);
    await ctx.editMessageText('🗑️ Panier vidé.');
  });

  bot.callbackQuery('back_categories', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCategories(ctx);
  });

  // Handle regular text messages (for admin responses forwarded to users)
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || [
      '🛍️ Boutique', '🛒 Mon Panier', '📦 Mes Commandes', '💬 Contact', 'ℹ️ À propos'
    ].includes(text)) return;

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

    await ctx.reply('💬 Votre message a été transmis à notre équipe. Nous vous répondrons rapidement!', {
      reply_markup: getMainKeyboard()
    });
  });

  return bot;
}

export function getBotInstance() {
  return bot;
}

function getMainKeyboard() {
  return new Keyboard()
    .text('🛍️ Boutique').text('🛒 Mon Panier').row()
    .text('📦 Mes Commandes').text('💬 Contact').row()
    .text('ℹ️ À propos')
    .resized()
    .persistent();
}

async function showCategories(ctx) {
  const categories = db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order').all();

  const keyboard = new InlineKeyboard();
  categories.forEach((cat, i) => {
    keyboard.text(`${cat.emoji} ${cat.name}`, `cat_${cat.id}`);
    if ((i + 1) % 2 === 0) keyboard.row();
  });

  const text = '🛍️ *Nos Catégories*\n\nChoisissez une catégorie:';
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function showProducts(ctx, catId) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
  const products = db.prepare('SELECT * FROM products WHERE category_id = ? AND active = 1').all(catId);

  if (!products.length) {
    await ctx.editMessageText('😔 Aucun produit disponible dans cette catégorie.');
    return;
  }

  const keyboard = new InlineKeyboard();
  products.forEach((prod, i) => {
    const stockIcon = prod.stock > 10 ? '🟢' : prod.stock > 0 ? '🟡' : '🔴';
    keyboard.text(`${stockIcon} ${prod.name} - ${prod.price}€`, `prod_${prod.id}`);
    keyboard.row();
  });
  keyboard.text('◀️ Retour', 'back_categories');

  await ctx.editMessageText(
    `${cat.emoji} *${cat.name}*\n\n🟢 En stock  🟡 Stock faible  🔴 Rupture`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function showProductDetail(ctx, prodId) {
  const prod = db.prepare(`
    SELECT p.*, c.name as cat_name, c.emoji as cat_emoji
    FROM products p JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(prodId);

  if (!prod) {
    await ctx.editMessageText('Produit introuvable.');
    return;
  }

  const stockStatus = prod.stock > 10 ? '🟢 En stock' : prod.stock > 0 ? `🟡 Stock faible (${prod.stock} restants)` : '🔴 Rupture de stock';
  const cbdInfo = prod.cbd_percent > 0 ? `\n💚 CBD: ${prod.cbd_percent}%` : '';
  const thcInfo = prod.thc_percent > 0 ? `\n⚪ THC: < ${prod.thc_percent}%` : '';

  const text =
    `${prod.cat_emoji} *${prod.name}*\n\n` +
    `📝 ${prod.description || 'Produit CBD de qualité premium'}\n\n` +
    `💰 Prix: *${prod.price}€* / ${prod.unit}${cbdInfo}${thcInfo}\n` +
    `${stockStatus}`;

  const keyboard = new InlineKeyboard();
  if (prod.stock > 0) {
    keyboard
      .text('1️⃣', `addcart_${prod.id}_1`)
      .text('2️⃣', `addcart_${prod.id}_2`)
      .text('5️⃣', `addcart_${prod.id}_5`)
      .row()
      .text('🛒 Ajouter au panier', `addcart_${prod.id}_1`)
      .row();
  }
  keyboard.text(`◀️ Retour aux ${prod.cat_name}`, `cat_${prod.cat_id || prod.category_id}`);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function showCart(ctx) {
  const telegramId = ctx.from.id;
  const items = db.prepare(`
    SELECT c.quantity, p.id as product_id, p.name, p.price, p.unit, p.stock,
           (c.quantity * p.price) as subtotal
    FROM carts c JOIN products p ON c.product_id = p.id
    WHERE c.telegram_id = ?
  `).all(telegramId);

  if (!items.length) {
    const text = '🛒 *Votre panier est vide*\n\nAjoutez des produits depuis la boutique!';
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
    return;
  }

  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  let text = '🛒 *Votre Panier*\n\n';
  items.forEach(item => {
    text += `• ${item.name} x${item.quantity} = *${item.subtotal.toFixed(2)}€*\n`;
  });
  text += `\n💰 *Total: ${total.toFixed(2)}€*`;

  const keyboard = new InlineKeyboard();
  items.forEach(item => {
    keyboard.text(`❌ Retirer ${item.name}`, `removecart_${item.product_id}`).row();
  });
  keyboard
    .text('✅ Commander', 'checkout').row()
    .text('🗑️ Vider le panier', 'clearcart');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function processCheckout(ctx) {
  const telegramId = ctx.from.id;
  const items = db.prepare(`
    SELECT c.quantity, p.id as product_id, p.name, p.price, p.stock
    FROM carts c JOIN products p ON c.product_id = p.id
    WHERE c.telegram_id = ?
  `).all(telegramId);

  if (!items.length) {
    await ctx.editMessageText('🛒 Votre panier est vide.');
    return;
  }

  // Check stock
  for (const item of items) {
    if (item.stock < item.quantity) {
      await ctx.editMessageText(
        `❌ Stock insuffisant pour *${item.name}*.\nDisponible: ${item.stock} ${item.quantity > 1 ? 'unités' : 'unité'}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
  }

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  const total = items.reduce((sum, i) => sum + (i.quantity * i.price), 0);

  // Create order in transaction
  const createOrder = db.transaction(() => {
    const order = db.prepare(
      'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)'
    ).run(user.id, total, 'pending');

    const orderId = order.lastInsertRowid;
    for (const item of items) {
      db.prepare(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)'
      ).run(orderId, item.product_id, item.quantity, item.price, item.quantity * item.price);

      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
        .run(item.quantity, item.product_id);
    }

    db.prepare('DELETE FROM carts WHERE telegram_id = ?').run(telegramId);
    return orderId;
  });

  const orderId = createOrder();

  // Notify admin
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  broadcastToAdmins({
    type: 'new_order',
    order: {
      ...order,
      username: user.username,
      first_name: user.first_name,
      items
    }
  });

  await ctx.editMessageText(
    `✅ *Commande #${orderId} confirmée!*\n\n` +
    `💰 Total: *${total.toFixed(2)}€*\n\n` +
    `Notre équipe va traiter votre commande et vous contacter rapidement.\n` +
    `Tapez 📦 *Mes Commandes* pour suivre l'état de votre commande.`,
    { parse_mode: 'Markdown' }
  );
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
    await ctx.reply('📦 Vous n\'avez pas encore de commandes.\n\nCommencez par parcourir notre boutique! 🛍️');
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

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: getMainKeyboard() });
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

function addToCart(telegramId, productId, quantity) {
  db.prepare(`
    INSERT INTO carts (telegram_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity
  `).run(telegramId, productId, quantity);
}

export async function sendMessageToUser(telegramId, text) {
  if (!bot) return;
  await bot.api.sendMessage(telegramId, text, { parse_mode: 'Markdown' });
}
