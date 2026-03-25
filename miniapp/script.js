// ================================================
// BALTIMORE 83 — script.js
// ================================================

// ── TELEGRAM ──
const tg = window.Telegram?.WebApp || {
  ready:()=>{}, expand:()=>{}, enableClosingConfirmation:()=>{},
  HapticFeedback:{impactOccurred:()=>{}},
  sendData:(d)=>console.log("sendData:", d),
  initDataUnsafe:{ user:{ username:"demo_user", id: 0 } }
};
tg.ready(); tg.expand(); tg.enableClosingConfirmation();

// ── STATE ──
let products = [];
let categories = [];
let cart = [];
let currentFilter = "tous";
let selectedQtyIndex = 0; // for modal quantity selection

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

// ── INIT ──
async function init() {
  loadCart();
  showSkeletons();
  try {
    const [cats, prods] = await Promise.all([
      apiGet("/api/categories"),
      apiGet("/api/products"),
    ]);
    categories = cats.filter(c => c.active !== 0 && c.active !== false);
    products = prods.filter(p => p.active !== 0 && p.active !== false);
    buildCatSelect();
  } catch(e) {
    console.warn("API indispo:", e);
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
}

// ── FILTER ──
function filterProducts(val) {
  currentFilter = val;
  renderProducts();
}

function getFiltered() {
  return products.filter(p => {
    if (currentFilter === "tous") return true;
    return (p.category_name || "").toLowerCase() === currentFilter;
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
      ? `${tiers[0].price}€ – ${tiers[tiers.length-1].price}€`
      : `${parseFloat(p.price||0).toFixed(0)} €/${p.unit || "u"}`;

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
        <div class="modal-price-simple">${parseFloat(p.price).toFixed(2).replace(".", ",")} €</div>
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
      <div class="modal-stock">Stock : ${p.stock} ${p.unit || "unité"}${p.stock > 1 ? "s" : ""}</div>
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

  const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);

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

  el.innerHTML = `
    <div class="cart-items">${itemsHtml}</div>
    <div class="cart-summary">
      <div class="summary-row"><span>Articles</span><span>${totalQty}</span></div>
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

function renderDeliveryForm() {
  const el = document.getElementById("cartContent");
  if (!el) return;

  const n = localStorage.getItem("b83_name") || "";
  const p = localStorage.getItem("b83_phone") || "";
  const a = localStorage.getItem("b83_address") || "";

  const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const lines = cart.map(i =>
    `<div class="dsummary-row"><span>${i.name}</span><span>${(i.price * i.qty).toFixed(2).replace(".", ",")} €</span></div>`
  ).join("");

  el.innerHTML = `
    <div class="delivery-form">
      <div class="delivery-back" onclick="renderCart()">← Retour au panier</div>
      <div class="delivery-title">📦 Informations de livraison</div>
      <div class="delivery-subtitle">Remplissez vos coordonnées pour finaliser</div>

      <div class="delivery-summary">
        <div class="dsummary-title">🛒 Récap commande</div>
        ${lines}
        <div class="dsummary-total"><span>Total</span><span>${totalPrice.toFixed(2).replace(".", ",")} €</span></div>
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
        <textarea id="fieldAddress" class="delivery-input delivery-textarea" placeholder="12 rue des Fleurs, 83000 Toulon" rows="3">${a}</textarea>
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
  // Scroll to top
  el.scrollIntoView({ behavior: "smooth" });
}

async function confirmOrder() {
  const name    = document.getElementById("fieldName").value.trim();
  const phone   = document.getElementById("fieldPhone").value.trim();
  const address = document.getElementById("fieldAddress").value.trim();
  const notes   = document.getElementById("fieldNotes")?.value.trim() || "";

  if (!name)    { showToast("⚠️ Entrez votre nom complet"); return; }
  if (!phone)   { showToast("⚠️ Entrez votre numéro de téléphone"); return; }
  if (!address) { showToast("⚠️ Entrez votre adresse de livraison"); return; }

  localStorage.setItem("b83_name", name);
  localStorage.setItem("b83_phone", phone);
  localStorage.setItem("b83_address", address);

  const btn = document.getElementById("confirmOrderBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Envoi en cours..."; }

  const user = tg.initDataUnsafe?.user || {};
  const telegramId = user.id || 0;

  try {
    const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
    await apiPost("/api/miniapp/order", {
      telegram_id: telegramId,
      delivery_name: name,
      delivery_phone: phone,
      delivery_address: address,
      notes: notes || null,
      items: cart.map(i => ({
        product_id: i.id,
        quantity: i.gram_qty || i.qty,
        unit_price: i.gram_qty ? parseFloat((i.price / i.gram_qty).toFixed(4)) : i.price,
      })),
      total: totalPrice,
    });

    cart = [];
    saveCart();
    updateCartBadge();
    showToast("🎉 Commande envoyée !");
    setTimeout(() => switchTab("produits"), 1400);
  } catch(e) {
    showToast("❌ " + (e.message || "Erreur, réessaie"));
    if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmer la commande"; }
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
