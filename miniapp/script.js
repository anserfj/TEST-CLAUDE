// ================================================
// BALTIMORE 83 — script.js
// ================================================

// ── TELEGRAM ──
const tg = window.Telegram?.WebApp || {
  ready:()=>{}, expand:()=>{}, enableClosingConfirmation:()=>{},
  HapticFeedback:{impactOccurred:()=>{}},
  sendData:(d)=>{},
  initDataUnsafe:{ user:{ username:"demo_user", id: 0 } }
};
tg.ready(); tg.expand(); tg.enableClosingConfirmation();

// ── STATE ──
let products = [];
let categories = [];
let cart = [];
let currentFilter = "tous";
let currentSearch = "";
let selectedQtyIndex = 0; // for modal quantity selection
let shopSettings = { delivery_fee: "3.00", free_delivery_threshold: "50.00" };
let promoData = null; // { code, discount_type, discount_value, min_order, ... }

const STATUS_STEPS = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered'];
const STATUS_STEP_LABELS = { pending:'Attente', confirmed:'Confirmée', preparing:'En prépa', shipped:'Expédiée', delivered:'Livrée' };

// Tiers par défaut si le produit n'a pas de tiers configurés
const QTY_TIERS = [
  { qty: 10 }, { qty: 25 }, { qty: 50 }, { qty: 100 },
];

// Retourne les tiers d'un produit (custom ou calculés depuis prix/g)
function getProductTiers(p) {
  if (p.tiers && p.tiers.length > 0) return p.tiers;
  const pricePerGram = parseFloat(p.price);
  return QTY_TIERS.map(t => ({ qty: t.qty, price: pricePerGram * t.qty }));
}

// ── CART PERSISTENCE ──
function saveCart() {
  try { localStorage.setItem("baltimore83_cart", JSON.stringify(cart)); } catch(e) {}
}
function loadCart() {
  try {
    const saved = localStorage.getItem("baltimore83_cart");
    if (saved) cart = JSON.parse(saved);
  } catch(e) { cart = []; }
}

// ── API ──
async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `API ${r.status}`);
  }
  return r.json();
}

// ── SHOP IDENTITY ──
function applyShopIdentity() {
  const name = shopSettings.shop_name || "";
  const tagline = shopSettings.shop_tagline || shopSettings.shop_banner || "";
  const banner = document.getElementById("bannerText");
  const logo = document.getElementById("shopLogoText");
  if (banner) banner.textContent = tagline || (name ? `${name}` : "");
  if (logo && name) logo.textContent = name.substring(0, 3).toUpperCase();
  if (name) document.title = name + " · Boutique";
}

// ── CONTACT LINKS ──
function applyContactLinks() {
  const tgUrl = shopSettings.telegram_url || "";
  const tgSocLink = document.getElementById("socialTelegramLink");
  if (tgSocLink && tgUrl) tgSocLink.href = tgUrl;

  const igUrl = shopSettings.instagram_url || "";
  const igLink = document.getElementById("socialInstagramLink");
  const igDesc = document.getElementById("socialInstagramDesc");
  if (igLink && igUrl) igLink.href = igUrl;
  if (igDesc && igUrl) igDesc.textContent = igUrl.replace("https://www.instagram.com/", "@").replace(/\/$/, "");
}

// ── ACCÈS NON VALIDÉ ──
function showAccessBlocked() {
  document.querySelector("nav.tabs")?.style.setProperty("display", "none");
  const main = document.querySelector("main.main");
  if (main) main.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:32px;text-align:center">
      <div style="font-size:56px;margin-bottom:16px">🔒</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:1.8rem;letter-spacing:.05em;margin-bottom:12px">Accès sur invitation</div>
      <div style="color:#aaa;font-size:.95rem;line-height:1.6;margin-bottom:28px">
        Cette boutique est réservée aux membres invités.<br>
        Pour obtenir l'accès, demande un <b>code de parrainage</b><br>à un client existant et entre-le dans le bot.
      </div>
      <a href="https://t.me/" id="botAccessLink" style="display:inline-block;background:#fff;color:#000;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:.95rem">
        Ouvrir le bot →
      </a>
    </div>
  `;
  // Mettre à jour le lien vers le bot depuis les settings
  const tgUrl = shopSettings.telegram_url;
  if (tgUrl) { const el = document.getElementById("botAccessLink"); if (el) el.href = tgUrl; }
}

// ── INIT ──
async function init() {
  loadCart();
  showSkeletons();
  try {
    const [cats, prods, settings] = await Promise.all([
      apiGet("/api/categories"),
      apiGet("/api/products"),
      apiGet("/api/settings").catch(() => ({})),
    ]);
    categories = cats.filter(c => c.active !== 0 && c.active !== false);
    products = prods.filter(p => p.active !== 0 && p.active !== false);
    if (settings) shopSettings = { ...shopSettings, ...settings };
    applyShopIdentity();
    applyContactLinks();

    // Vérifier si l'utilisateur est validé
    const telegramId = tg.initDataUnsafe?.user?.id;
    if (telegramId) {
      try {
        const access = await apiGet(`/api/miniapp/access/${telegramId}`);
        if (!access.validated) { showAccessBlocked(); return; }
      } catch(e) { /* si l'API échoue, laisser accéder (fail-open) */ }
    }

    buildCatSelect();
  } catch(e) {
    console.warn("API indispo:", e);
    categories = [];
    products = [];
  }
  renderProducts();
  updateCartBadge();
}

// ── BUILD CATEGORY SELECT ──
function buildCatSelect() {
  const sel = document.getElementById("catSelect");
  if (!sel) return;
  // Keep "Toutes les catégories" first
  sel.innerHTML = `<option value="tous">Toutes les catégories</option>`;
  categories.forEach(cat => {
    const em = cat.emoji ? cat.emoji + " " : "";
    sel.innerHTML += `<option value="${cat.name.toLowerCase()}">${em}${cat.name}</option>`;
  });
}

// ── SKELETONS ──
function showSkeletons() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  grid.innerHTML = Array(4).fill(0).map(() => `
    <div style="background:var(--surface);border-radius:14px;border:1px solid var(--border);overflow:hidden;animation:pulse 1.5s ease infinite">
      <div style="aspect-ratio:1/1;background:var(--bg3)"></div>
      <div style="padding:10px">
        <div style="height:12px;background:var(--bg3);border-radius:4px;width:80%;margin-bottom:8px"></div>
        <div style="height:8px;background:var(--bg3);border-radius:4px;width:50%"></div>
      </div>
    </div>`).join("");
}

// ── NAVIGATION ──
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active", p.id === `page-${tab}`)
  );
  if (tab === "panier") renderCart();
  if (tab === "commandes") loadOrders();
}

// ── FILTER / SEARCH ──
function filterProducts(val) {
  currentFilter = val;
  renderProducts();
}

function searchProducts(val) {
  currentSearch = val.trim().toLowerCase();
  renderProducts();
}

function getFiltered() {
  return products.filter(p => {
    const matchCat = currentFilter === "tous" || (p.category_name || "").toLowerCase() === currentFilter;
    const matchSearch = !currentSearch ||
      (p.name || "").toLowerCase().includes(currentSearch) ||
      (p.description || "").toLowerCase().includes(currentSearch);
    return matchCat && matchSearch;
  });
}

// ── RENDER PRODUCTS ──
function renderProducts() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  const filtered = getFiltered();

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 0;color:var(--text3)">
      <div style="font-size:2rem;margin-bottom:8px">🔍</div>
      <div style="font-size:.85rem">Aucun produit trouvé</div>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const emoji = p.category_emoji || "🛍️";
    const vidUrl = p.video_url || (p.image_url && /\.(mp4|webm|ogg|mov)$/i.test(p.image_url) ? p.image_url : null);
    const imgUrl = !vidUrl ? p.image_url : null;
    let mediaPart;
    if (vidUrl) {
      mediaPart = `
        <video src="${vidUrl}" style="width:100%;height:100%;object-fit:cover" autoplay muted loop playsinline></video>
        <div class="product-video-play">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity=".85"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,.4)"/><polygon points="10,8 18,12 10,16" fill="white"/></svg>
        </div>`;
    } else if (imgUrl) {
      mediaPart = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="${p.name}" loading="lazy">`;
    } else {
      mediaPart = `<span style="font-size:3.2rem">${emoji}</span>`;
    }

    const catName = p.category_name || "";
    const catEmoji = p.category_emoji || "";
    const tiers = getProductTiers(p);
    const priceTag = tiers && tiers.length > 0
      ? `${parseFloat(tiers[0].price).toFixed(0)}€ – ${parseFloat(tiers[tiers.length-1].price).toFixed(0)}€`
      : `${parseFloat(p.price||0).toFixed(0)}€/${p.unit || "unité"}`;

    return `<div class="product-card" onclick="openModal(${p.id})">
      <div class="product-img-wrap">${mediaPart}</div>
      <div class="product-body">
        <div class="product-name">${p.name}</div>
        <div class="product-tags">
          ${catName ? `<span class="product-tag cat-tag">${catEmoji} ${catName}</span>` : ""}
          <span class="product-tag price-tag">${priceTag}</span>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ── MODAL ──
function openModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  tg.HapticFeedback.impactOccurred("light");
  selectedQtyIndex = 0;

  const emoji = p.category_emoji || "🛍️";
  const vidUrl = p.video_url || (p.image_url && /\.(mp4|webm|ogg|mov)$/i.test(p.image_url) ? p.image_url : null);
  const imgUrl = !vidUrl ? p.image_url : null;

  let mediaPart;
  if (vidUrl) {
    mediaPart = `
      <video src="${vidUrl}" style="width:100%;height:100%;object-fit:cover" autoplay muted loop playsinline></video>
      <div class="modal-play-btn">
        <svg width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="26" fill="rgba(0,0,0,.45)"/><polygon points="21,16 40,26 21,36" fill="white"/></svg>
      </div>`;
  } else if (imgUrl) {
    mediaPart = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover" alt="${p.name}">`;
  } else {
    mediaPart = `<span>${emoji}</span>`;
  }

  // Check if product uses grams — build qty tiers
  const isGram = (p.unit || "g").toLowerCase() === "g";
  const pricePerGram = parseFloat(p.price);
  let pricingHtml = "";

  if (isGram) {
    const tiers = getProductTiers(p);
    pricingHtml = `
      <div class="modal-price-section">
        <div class="modal-price-label">Choisissez votre quantité</div>
        <div class="qty-grid" id="qtyGrid">
          ${tiers.map((t, i) => `
            <div class="qty-option ${i === 0 ? 'selected' : ''}" onclick="selectQty(${i}, ${p.id})" id="qty-opt-${i}">
              <div class="qty-option-qty">${t.qty}g</div>
              <div class="qty-option-price">${t.price.toFixed(0)}€</div>
            </div>`).join("")}
        </div>
      </div>`;
  } else {
    pricingHtml = `
      <div class="modal-price-section">
        <div class="modal-price-simple">${parseFloat(p.price||0).toFixed(0)}€</div>
        <div class="modal-unit">par ${p.unit || "unité"}</div>
      </div>`;
  }

  const catName = p.category_name || "";
  const catEmoji = p.category_emoji || "";

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-media">${mediaPart}</div>
    <div class="modal-content">
      <div class="modal-tags">
        ${catName ? `<span class="modal-tag">${catEmoji} ${catName}</span>` : ""}
      </div>
      <div class="modal-name">${p.name}</div>
      ${p.description ? `<div class="modal-desc">${p.description}</div>` : ""}
      ${pricingHtml}
      <button class="modal-add-btn" id="modalAddBtn" onclick="addToCartFromModal(${p.id})" ${p.stock <= 0 ? "disabled" : ""}>
        ${p.stock <= 0 ? "Rupture de stock" : "Ajouter au panier"}
      </button>
      <div class="modal-stock">Stock : ${p.stock} ${p.unit || "unité"}</div>
    </div>
  `;

  document.getElementById("modalOverlay").classList.add("open");
}

function selectQty(idx, productId) {
  selectedQtyIndex = idx;
  document.querySelectorAll(".qty-option").forEach((el, i) => {
    el.classList.toggle("selected", i === idx);
  });
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const tier = getProductTiers(p)[idx];
  const btn = document.getElementById("modalAddBtn");
  if (btn && p.stock > 0) {
    btn.textContent = `Ajouter ${tier.qty}g — ${tier.price.toFixed(0)}€`;
  }
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

// ── CART ──
function addToCartFromModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p || p.stock <= 0) return;

  const isGram = (p.unit || "g").toLowerCase() === "g";
  let qty = 1;
  let unitPrice = parseFloat(p.price);
  let label = p.name;

  if (isGram) {
    const tier = getProductTiers(p)[selectedQtyIndex];
    qty = tier.qty;
    unitPrice = tier.price; // fixed price for this tier
    label = `${p.name} (${tier.qty}g)`;
  }

  const cartItemId = isGram ? `${p.id}-${qty}g` : String(p.id);
  const existing = cart.find(x => x.cartItemId === cartItemId);
  if (existing) {
    showToast(`✅ ${label} déjà dans le panier`);
    closeModal();
    return;
  }

  cart.push({
    cartItemId,
    id: p.id,
    name: label,
    price: unitPrice, // for gram products: fixed tier price; for others: unit price
    qty: 1,
    gram_qty: isGram ? qty : null, // actual gram amount for gram products
    unit: p.unit,
    emoji: p.category_emoji || "🛍️",
    image_url: p.image_url || null,
  });

  saveCart();
  updateCartBadge();
  showToast(`✅ ${label} ajouté`);
  tg.HapticFeedback.impactOccurred("medium");
  closeModal();
}

function addToCart(productId) {
  addToCartFromModal(productId);
}

function updateQty(cartItemId, delta) {
  const item = cart.find(x => x.cartItemId === cartItemId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.cartItemId !== cartItemId);
  saveCart();
  updateCartBadge();
  renderCart();
}

function removeFromCart(cartItemId) {
  cart = cart.filter(x => x.cartItemId !== cartItemId);
  saveCart();
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const el = document.getElementById("cartCount");
  if (!el) return;
  el.textContent = total;
  el.classList.toggle("visible", total > 0);
}

// ── RENDER CART ──
function renderCart() {
  const el = document.getElementById("cartContent");
  if (!el) return;

  if (cart.length === 0) {
    el.innerHTML = `<div class="cart-empty">
      <div class="empty-icon">🛒</div>
      <h3>Panier vide</h3>
      <p>Parcourez le catalogue pour ajouter des produits</p>
      <button class="btn-shop" onclick="switchTab('produits')">Voir le catalogue</button>
    </div>`;
    return;
  }

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const deliveryFee = parseFloat(shopSettings.delivery_fee || 3);
  const freeThreshold = parseFloat(shopSettings.free_delivery_threshold || 50);
  const isFreeDelivery = subtotal >= freeThreshold;
  const totalPrice = subtotal + (isFreeDelivery ? 0 : deliveryFee);

  const itemsHtml = cart.map(item => {
    let thumbHtml;
    if (item.image_url) {
      const isVid = /\.(mp4|webm|ogg|mov)$/i.test(item.image_url);
      thumbHtml = isVid
        ? `<video src="${item.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" muted loop playsinline></video>`
        : `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" alt="">`;
    } else {
      thumbHtml = item.emoji || "🛍️";
    }
    return `
    <div class="cart-item">
      <div class="cart-item-thumb">${thumbHtml}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${(item.price * item.qty).toFixed(2).replace(".", ",")} €</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn del" onclick="removeFromCart('${item.cartItemId}')">🗑</button>
        <button class="qty-btn" onclick="updateQty('${item.cartItemId}', -1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty('${item.cartItemId}', 1)">+</button>
      </div>
    </div>`;
  }).join("");

  const deliveryRow = isFreeDelivery
    ? `<div class="summary-row delivery free"><span>🚚 Livraison</span><span style="color:#00e676">Offerte ✓</span></div>`
    : `<div class="summary-row delivery"><span>🚚 Livraison</span><span>${deliveryFee.toFixed(2).replace(".", ",")} €</span></div>`;
  const freeMsg = !isFreeDelivery
    ? `<div class="delivery-msg">Plus que ${(freeThreshold - subtotal).toFixed(2).replace(".", ",")} € pour la livraison offerte</div>`
    : "";

  el.innerHTML = `
    <div class="cart-items">${itemsHtml}</div>
    <div class="cart-summary">
      <div class="summary-row"><span>Articles</span><span>${totalQty}</span></div>
      <div class="summary-row"><span>Sous-total</span><span>${subtotal.toFixed(2).replace(".", ",")} €</span></div>
      ${deliveryRow}
      ${freeMsg}
      <div class="summary-row total"><span>Total</span><span>${totalPrice.toFixed(2).replace(".", ",")} €</span></div>
    </div>
    <button class="btn-checkout" onclick="checkout()">Passer la commande</button>
  `;
}

// ── CHECKOUT — show delivery form inline ──
function checkout() {
  if (cart.length === 0) return;
  renderDeliveryForm();
}

const SLOTS = [
  { id: "debut", label: "🌇 Début d'après-midi", time: "13h – 16h" },
  { id: "aprem", label: "🌆 Fin d'après-midi",   time: "16h – 19h" },
  { id: "soir",  label: "🌙 Soirée",              time: "19h – 23h" },
];
let selectedSlot = "debut";

function renderDeliveryForm() {
  const el = document.getElementById("cartContent");
  if (!el) return;

  const n = localStorage.getItem("b83_name") || "";
  const p = localStorage.getItem("b83_phone") || "";
  const a = localStorage.getItem("b83_address") || "";

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = parseFloat(shopSettings.delivery_fee || 3);
  const freeThreshold = parseFloat(shopSettings.free_delivery_threshold || 50);
  const isFree = subtotal >= freeThreshold;
  const total = subtotal + (isFree ? 0 : deliveryFee);

  const lines = cart.map(i =>
    `<div class="dsummary-row"><span>${i.name}</span><span>${(i.price * i.qty).toFixed(2).replace(".", ",")} €</span></div>`
  ).join("");

  const slotsHtml = SLOTS.map(s => `
    <div class="slot-option ${s.id === selectedSlot ? "selected" : ""}" onclick="selectSlot('${s.id}')">
      <div class="slot-label">${s.label}</div>
      <div class="slot-time">${s.time}</div>
    </div>`).join("");

  const savedPromoCode = promoData ? promoData.code : '';
  const savedDiscount = calcDiscount(subtotal);
  const totalWithPromo = total - savedDiscount;

  el.innerHTML = `
    <div class="delivery-form">
      <div class="delivery-back" onclick="renderCart()">← Retour au panier</div>
      <div class="delivery-title">📦 Informations de livraison</div>
      <div class="delivery-subtitle">Remplissez vos coordonnées pour finaliser</div>

      <div class="delivery-summary">
        <div class="dsummary-title">🛒 Récap commande</div>
        ${lines}
        <div class="dsummary-row" style="color:#8a8a8a">
          <span>🚚 Livraison</span>
          <span>${isFree ? '<span style="color:#4caf50">Offerte ✓</span>' : deliveryFee.toFixed(2).replace(".",",") + " €"}</span>
        </div>
        <div class="dsummary-row" id="dDiscountRow" style="${savedDiscount > 0 ? '' : 'display:none'}">
          <span>🎁 ${savedPromoCode}</span>
          <span style="color:#00e676">-${savedDiscount.toFixed(2).replace('.',',')} €</span>
        </div>
        <div class="dsummary-total"><span>Total</span><span id="dTotalAmount">${totalWithPromo.toFixed(2).replace(".", ",")} €</span></div>
      </div>

      <div class="delivery-field">
        <label class="delivery-label">⏰ Créneau de livraison</label>
        <div class="slots-grid" id="slotsGrid">${slotsHtml}</div>
      </div>

      <div class="delivery-field">
        <label class="delivery-label">Nom complet *</label>
        <input id="fieldName" class="delivery-input" type="text" value="${n}" placeholder="Jean Dupont" autocomplete="name" />
      </div>
      <div class="delivery-field">
        <label class="delivery-label">Numéro de téléphone *</label>
        <input id="fieldPhone" class="delivery-input" type="tel" value="${p}" placeholder="+33 6 12 34 56 78" autocomplete="tel" />
      </div>
      <div class="delivery-field">
        <label class="delivery-label">Adresse de livraison *</label>
        <div style="display:flex;gap:8px;align-items:flex-start">
          <textarea id="fieldAddress" class="delivery-input delivery-textarea" placeholder="12 rue des Fleurs, 83000 Toulon" rows="2" style="flex:1" oninput="deliveryLatLng=null">${a}</textarea>
          <button onclick="openMap()" class="map-btn" title="Voir les zones et choisir sur la carte">📍</button>
        </div>
        ${(()=>{try{const z=JSON.parse(shopSettings.no_delivery_zones||'[]');return z.length?`<div style="font-size:.75rem;color:#ff6b6b;margin-top:6px;display:flex;align-items:center;gap:5px">🚫 Certaines zones ne sont pas livrées — appuyez sur 📍 pour voir la carte</div>`:''}catch{return ''}})()}
      </div>
      <div class="delivery-field">
        <label class="delivery-label">Code promo (optionnel)</label>
        <div class="promo-row">
          <input id="fieldPromo" class="delivery-input" type="text" placeholder="EX: PROMO10" value="${savedPromoCode}" style="text-transform:uppercase" />
          <button id="promoApplyBtn" class="promo-apply-btn" onclick="applyPromo(document.getElementById('fieldPromo').value)">Appliquer</button>
        </div>
        <div id="promoMsg" style="font-size:.78rem;margin-top:4px">
          ${savedDiscount > 0 ? `<span style="color:#00e676">✓ Code appliqué</span>` : ''}
        </div>
      </div>
      <div class="delivery-field">
        <label class="delivery-label">Notes (optionnel)</label>
        <input id="fieldNotes" class="delivery-input" type="text" placeholder="Digicode, étage, instructions..." />
      </div>

      <button class="btn-checkout" id="confirmOrderBtn" onclick="confirmOrder()">
        ✅ Confirmer la commande
      </button>
    </div>
  `;
  el.scrollIntoView({ behavior: "smooth" });
}

// ── PROMO CODES ──
function calcDiscount(subtotal) {
  if (!promoData) return 0;
  if (promoData.discount_type === 'percent') return Math.min(subtotal * promoData.discount_value / 100, subtotal);
  return Math.min(promoData.discount_value, subtotal);
}

async function applyPromo(code) {
  const btn = document.getElementById("promoApplyBtn");
  const msg = document.getElementById("promoMsg");
  if (!code.trim()) return;
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const promo = await apiGet(`/api/promo/${encodeURIComponent(code.trim().toUpperCase())}`);
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (promo.min_order > 0 && subtotal < promo.min_order) {
      if (msg) msg.innerHTML = `<span style="color:#ff4757">Minimum de commande : ${promo.min_order.toFixed(0)} €</span>`;
      promoData = null;
      return;
    }
    promoData = promo;
    const discount = calcDiscount(subtotal);
    const display = promo.discount_type === 'percent' ? `-${promo.discount_value}%` : `-${discount.toFixed(2).replace('.', ',')} €`;
    if (msg) msg.innerHTML = `<span style="color:#00e676">✓ Réduction appliquée : ${display}</span>`;
    // Update total and discount row inline
    const deliveryFee = parseFloat(shopSettings.delivery_fee || 3);
    const freeThreshold = parseFloat(shopSettings.free_delivery_threshold || 50);
    const isFree = subtotal >= freeThreshold;
    const newTotal = subtotal + (isFree ? 0 : deliveryFee) - discount;
    const discountRowEl = document.getElementById("dDiscountRow");
    if (discountRowEl) {
      discountRowEl.style.display = '';
      discountRowEl.innerHTML = `<span>🎁 ${promo.code}</span><span style="color:#00e676">-${discount.toFixed(2).replace('.', ',')} €</span>`;
    }
    const totalEl = document.getElementById("dTotalAmount");
    if (totalEl) totalEl.textContent = newTotal.toFixed(2).replace('.', ',') + ' €';
  } catch(e) {
    promoData = null;
    if (msg) msg.innerHTML = `<span style="color:#ff4757">${e.message || 'Code invalide'}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Appliquer"; }
  }
}

// ── ORDER PROGRESS TRACKER ──
function orderTrackerHtml(status) {
  if (status === 'cancelled') {
    return `<div style="text-align:center;font-size:.75rem;color:#ff4757;padding:6px 0">❌ Commande annulée</div>`;
  }
  const currentIdx = STATUS_STEPS.indexOf(status);
  const dots = STATUS_STEPS.map((s, i) => {
    const done = i <= currentIdx;
    const active = i === currentIdx;
    return `<div class="t-dot${done ? ' done' : ''}${active ? ' active' : ''}"></div>${i < STATUS_STEPS.length - 1 ? `<div class="t-line${done ? ' done' : ''}"></div>` : ''}`;
  }).join('');
  const labels = STATUS_STEPS.map((s, i) => {
    const done = i <= currentIdx;
    const active = i === currentIdx;
    return `<span class="${done ? 'done' : ''}${active ? ' active' : ''}">${STATUS_STEP_LABELS[s]}</span>`;
  }).join('');
  return `<div class="order-tracker"><div class="t-steps">${dots}</div><div class="t-labels">${labels}</div></div>`;
}

// ── REORDER ──
function reorder(orderItems) {
  let added = 0;
  orderItems.forEach(item => {
    const p = products.find(x => x.id === item.product_id);
    if (!p || p.stock <= 0) return;
    const isGram = (p.unit || 'g').toLowerCase() === 'g';
    if (isGram) {
      const tiers = getProductTiers(p);
      const tier = tiers.reduce((best, t) => Math.abs(t.qty - item.quantity) < Math.abs(best.qty - item.quantity) ? t : best, tiers[0]);
      const cartItemId = `${p.id}-${tier.qty}g`;
      if (!cart.find(c => c.cartItemId === cartItemId)) {
        cart.push({ cartItemId, id: p.id, name: `${p.name} (${tier.qty}g)`, price: tier.price, qty: 1, gram_qty: tier.qty, unit: p.unit, emoji: p.category_emoji || '🛍️', image_url: p.image_url || null });
        added++;
      }
    } else {
      const cartItemId = String(p.id);
      if (!cart.find(c => c.cartItemId === cartItemId)) {
        cart.push({ cartItemId, id: p.id, name: p.name, price: parseFloat(p.price), qty: item.quantity || 1, gram_qty: null, unit: p.unit, emoji: p.category_emoji || '🛍️', image_url: p.image_url || null });
        added++;
      }
    }
  });
  if (added > 0) {
    saveCart(); updateCartBadge();
    showToast(`✅ ${added} article${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au panier`);
    tg.HapticFeedback.impactOccurred('medium');
    setTimeout(() => switchTab('panier'), 900);
  } else {
    showToast('⚠️ Articles déjà au panier ou indisponibles');
  }
}

function selectSlot(id) {
  selectedSlot = id;
  document.querySelectorAll(".slot-option").forEach(el => {
    el.classList.toggle("selected", el.onclick?.toString().includes(`'${id}'`));
  });
  // Re-render slots to update classes cleanly
  const grid = document.getElementById("slotsGrid");
  if (grid) grid.innerHTML = SLOTS.map(s => `
    <div class="slot-option ${s.id === id ? "selected" : ""}" onclick="selectSlot('${s.id}')">
      <div class="slot-label">${s.label}</div>
      <div class="slot-time">${s.time}</div>
    </div>`).join("");
}

// ── MAP PICKER ──
let mapInstance = null;
let mapMarker = null;
let geocodeTimer = null;
let pendingAddress = "";
let deliveryLatLng = null; // coords GPS de l'adresse choisie (via carte ou geocodage)

/* ── ZONE HELPERS ── */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function pointInPoly(lat, lng, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [yi, xi] = coords[i], [yj, xj] = coords[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function getBlockedZone(lat, lng) {
  try {
    const zones = JSON.parse(shopSettings.no_delivery_zones || '[]');
    return zones.find(z => z.type === 'circle'
      ? haversineM(lat, lng, z.center[0], z.center[1]) <= z.radius
      : pointInPoly(lat, lng, z.coords || [])) || null;
  } catch { return null; }
}
async function forwardGeocode(address) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=fr`,
      { headers: { 'User-Agent': 'Baltimore83-MiniApp' } }
    );
    const d = await r.json();
    if (!d?.length) return null;
    return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch { return null; }
}
function drawZonesOnMap(map) {
  try {
    const zones = JSON.parse(shopSettings.no_delivery_zones || '[]');
    if (!zones.length) return;
    const style = { color: '#ff4757', fillColor: '#ff4757', fillOpacity: 0.22, weight: 2 };
    zones.forEach(z => {
      const layer = z.type === 'circle'
        ? L.circle([z.center[0], z.center[1]], { ...style, radius: z.radius })
        : L.polygon(z.coords || [], style);
      layer.bindTooltip(`🚫 ${z.name}`, { direction: 'center', permanent: false });
      layer.addTo(map);
    });
  } catch(e) {}
}

function openMap() {
  const overlay = document.getElementById("mapOverlay");
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";

  // Init map once
  if (!mapInstance) {
    // Default: Toulon, Var 83
    const defaultLat = 43.1242, defaultLng = 5.9280;
    mapInstance = L.map("mapContainer", { zoomControl: true }).setView([defaultLat, defaultLng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(mapInstance);

    const icon = L.divIcon({
      html: `<div style="width:36px;height:36px;background:#fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid #000">
               <div style="transform:rotate(45deg);font-size:16px">📍</div>
             </div>`,
      iconSize: [36, 36], iconAnchor: [18, 36], className: ""
    });
    mapMarker = L.marker([defaultLat, defaultLng], { icon, draggable: true }).addTo(mapInstance);

    mapMarker.on("dragend", () => reverseGeocode(mapMarker.getLatLng()));
    mapInstance.on("click", e => { mapMarker.setLatLng(e.latlng); reverseGeocode(e.latlng); });

    // Zones non livrées en rouge
    drawZonesOnMap(mapInstance);
  }

  // Try user geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      mapInstance.setView(latlng, 16);
      mapMarker.setLatLng(latlng);
      reverseGeocode(latlng);
    }, () => {});
  } else {
    reverseGeocode(mapMarker.getLatLng());
  }

  setTimeout(() => mapInstance.invalidateSize(), 200);
}

function reverseGeocode(latlng) {
  const preview = document.getElementById("mapAddressPreview");
  if (preview) preview.textContent = "Recherche de l'adresse...";
  clearTimeout(geocodeTimer);
  geocodeTimer = setTimeout(async () => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json&accept-language=fr`,
        { headers: { "User-Agent": "Baltimore83-MiniApp" } }
      );
      const data = await r.json();
      const addr = data.display_name || "";
      // Format nicely: "rue, code postal Ville"
      const a = data.address || {};
      const parts = [
        a.house_number, a.road, a.postcode,
        a.city || a.town || a.village || a.municipality
      ].filter(Boolean);
      pendingAddress = parts.join(", ") || addr;
      if (preview) preview.textContent = pendingAddress || "Adresse introuvable";
    } catch {
      pendingAddress = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
      if (preview) preview.textContent = "Coordonnées : " + pendingAddress;
    }
  }, 600);
}

function confirmMapAddress() {
  if (pendingAddress) {
    const field = document.getElementById("fieldAddress");
    if (field) field.value = pendingAddress;
    // Sauvegarder les coords GPS pour éviter de re-geocoder à la commande
    const ll = mapMarker?.getLatLng();
    deliveryLatLng = ll ? { lat: ll.lat, lng: ll.lng } : null;
  }
  closeMap();
}

function closeMap() {
  document.getElementById("mapOverlay").style.display = "none";
}

async function confirmOrder() {
  const name    = document.getElementById("fieldName").value.trim();
  const phone   = document.getElementById("fieldPhone").value.trim();
  const address = document.getElementById("fieldAddress").value.trim();
  const notes   = document.getElementById("fieldNotes")?.value.trim() || "";

  if (!name)    { showToast("⚠️ Entrez votre nom complet"); return; }
  if (!phone)   { showToast("⚠️ Entrez votre numéro de téléphone"); return; }
  if (!address) { showToast("⚠️ Entrez votre adresse de livraison"); return; }

  // Vérification zone non livrée
  try {
    const zones = JSON.parse(shopSettings.no_delivery_zones || '[]');
    if (zones.length > 0) {
      const btn = document.getElementById("confirmOrderBtn");
      if (btn) { btn.disabled = true; btn.textContent = "Vérification zone…"; }
      let coords = deliveryLatLng;
      if (!coords) coords = await forwardGeocode(address);
      if (coords) {
        const blocked = getBlockedZone(coords.lat, coords.lng);
        if (blocked) {
          showToast(`🚫 Zone non livrée : ${blocked.name}. Appuyez sur 📍 pour voir les zones.`);
          if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmer la commande"; }
          return;
        }
      }
      if (btn) { btn.disabled = false; }
    }
  } catch(e) {} // Ne jamais bloquer si geocodage échoue

  localStorage.setItem("b83_name", name);
  localStorage.setItem("b83_phone", phone);
  localStorage.setItem("b83_address", address);

  const slotInfo = SLOTS.find(s => s.id === selectedSlot);
  const slotNote = slotInfo ? `Créneau: ${slotInfo.label} ${slotInfo.time}` : "";

  const btn = document.getElementById("confirmOrderBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Envoi en cours..."; }

  const user = tg.initDataUnsafe?.user || {};
  const telegramId = user.id || 0;

  try {
    const subtotalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const deliveryFee = parseFloat(shopSettings.delivery_fee || 3);
    const freeThreshold = parseFloat(shopSettings.free_delivery_threshold || 50);
    const discount = calcDiscount(subtotalPrice);
    const totalPrice = subtotalPrice + (subtotalPrice >= freeThreshold ? 0 : deliveryFee) - discount;
    await apiPost("/api/miniapp/order", {
      telegram_id: telegramId,
      delivery_name: name,
      delivery_phone: phone,
      delivery_address: address,
      notes: [slotNote, notes].filter(Boolean).join(" — ") || null,
      promo_code: promoData ? promoData.code : null,
      discount,
      items: cart.map(i => ({
        product_id: i.id,
        quantity: i.gram_qty || i.qty,
        unit_price: i.gram_qty ? parseFloat((i.price / i.gram_qty).toFixed(4)) : i.price,
      })),
      total: totalPrice,
    });

    cart = [];
    promoData = null;
    saveCart();
    updateCartBadge();
    showToast("🎉 Commande envoyée !");
    setTimeout(() => switchTab("produits"), 1400);
  } catch(e) {
    showToast("❌ " + (e.message || "Erreur, réessaie"));
    if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmer la commande"; }
  }
}

// ── ORDERS HISTORY ──
async function loadOrders() {
  const el = document.getElementById("ordersContent");
  if (!el) return;

  const user = tg.initDataUnsafe?.user || {};
  const telegramId = user.id || 0;

  if (!telegramId) {
    el.innerHTML = `<div class="orders-empty">
      <div class="empty-icon">🔒</div>
      <h3>Non connecté</h3>
      <p>Ouvrez cette page via Telegram</p>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="display:flex;justify-content:center;padding:40px 0"><div class="orders-spinner"></div></div>`;

  try {
    const orders = await apiGet(`/api/miniapp/orders/${telegramId}`);

    if (!orders.length) {
      el.innerHTML = `<div class="orders-empty">
        <div class="empty-icon">📦</div>
        <h3>Aucune commande</h3>
        <p>Parcourez le catalogue pour passer votre première commande</p>
        <button class="btn-shop" onclick="switchTab('produits')">Voir le catalogue</button>
      </div>`;
      return;
    }

    const statusLabel = {
      pending: { label: "En attente", color: "#fff", bg: "rgba(255,255,255,.12)" },
      confirmed: { label: "Confirmée", color: "#a78bfa", bg: "rgba(167,139,250,.15)" },
      preparing: { label: "En prépa", color: "#f0b429", bg: "rgba(240,180,41,.15)" },
      shipped: { label: "Expédiée", color: "#00e676", bg: "rgba(0,230,118,.15)" },
      delivered: { label: "Livrée", color: "#00e676", bg: "rgba(0,230,118,.15)" },
      cancelled: { label: "Annulée", color: "#ff4757", bg: "rgba(255,71,87,.15)" },
    };

    el.innerHTML = orders.map((o, idx) => {
      const st = statusLabel[o.status] || statusLabel.pending;
      const date = new Date(o.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      const itemsHtml = (o.items || []).map(i =>
        `<div class="order-item-row">
          <span>${i.name}</span>
          <span>×${i.quantity}${i.unit || ""} — ${(i.subtotal || i.unit_price * i.quantity).toFixed(0)}€</span>
        </div>`
      ).join("");
      const trackerHtml = orderTrackerHtml(o.status);
      const itemsJson = JSON.stringify(o.items || []).replace(/'/g, "&#39;");
      const canReorder = o.status !== 'cancelled' && (o.items || []).length > 0;
      const discountHtml = o.discount > 0
        ? `<div class="order-card-discount"><span>🎁 ${o.promo_code || 'Promo'}</span><span>-${parseFloat(o.discount).toFixed(2).replace('.', ',')} €</span></div>`
        : '';

      return `<div class="order-card">
        <div class="order-card-header">
          <div>
            <div class="order-card-id">Commande #${o.id}</div>
            <div class="order-card-date">${date}</div>
          </div>
          <span class="order-status-badge" style="color:${st.color};background:${st.bg}">${st.label}</span>
        </div>
        ${trackerHtml}
        <div class="order-items">${itemsHtml}</div>
        ${discountHtml}
        <div class="order-card-total">
          <span>Total</span>
          <span>${parseFloat(o.total).toFixed(2).replace(".", ",")} €</span>
        </div>
        ${canReorder ? `<button class="reorder-btn" onclick='reorder(${itemsJson})'>↺ Recommander</button>` : ''}
      </div>`;
    }).join("");

  } catch(e) {
    el.innerHTML = `<div class="orders-empty">
      <div class="empty-icon">⚠️</div>
      <h3>Erreur</h3>
      <p>Impossible de charger les commandes</p>
      <button class="btn-shop" onclick="loadOrders()">Réessayer</button>
    </div>`;
  }
}

// ── TOAST ──
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

// ── START ──
document.addEventListener("DOMContentLoaded", init);
