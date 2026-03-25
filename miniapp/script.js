// ================================================
// BALTIMORE 83 — script.js (API locale)
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
let cart = [];
let currentFilter = "tous";
let currentSearch = "";

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
    const data = await apiGet("/api/products");
    products = data.filter(p => p.active !== 0 && p.active !== false);
  } catch(e) {
    console.warn("API indispo:", e);
    products = [];
  }
  renderProducts();
  updateCartBadge();
}

// ── SKELETONS ──
function showSkeletons() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  grid.innerHTML = Array(4).fill(0).map(() => `
    <div style="background:var(--surface);border-radius:14px;border:1px solid var(--border);overflow:hidden;animation:pulse 1.5s ease infinite">
      <div style="aspect-ratio:1/1;background:var(--bg3)"></div>
      <div style="padding:10px">
        <div style="height:8px;background:var(--bg3);border-radius:4px;width:40%;margin-bottom:8px"></div>
        <div style="height:12px;background:var(--bg3);border-radius:4px;width:80%;margin-bottom:8px"></div>
        <div style="height:10px;background:var(--bg3);border-radius:4px;width:50%"></div>
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

// ── FILTER & SEARCH ──
function filterProducts(cat) {
  currentFilter = cat;
  currentSearch = "";
  const si = document.getElementById("searchInput");
  if (si) si.value = "";
  document.querySelectorAll(".filter-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.cat === cat)
  );
  renderProducts();
}

function searchProducts(q) {
  currentSearch = q.toLowerCase().trim();
  renderProducts();
}

function getFiltered() {
  return products.filter(p => {
    const cat = (p.category_name || "").toLowerCase();
    const matchCat = currentFilter === "tous" || cat === currentFilter;
    const matchSearch = !currentSearch ||
      p.name?.toLowerCase().includes(currentSearch) ||
      p.description?.toLowerCase().includes(currentSearch) ||
      cat.includes(currentSearch);
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
    const isVid = p.image_url && /\.(mp4|webm|ogg)$/i.test(p.image_url);
    const mediaPart = p.image_url
      ? (isVid
          ? `<video src="${p.image_url}" style="width:100%;height:100%;object-fit:cover" autoplay muted loop playsinline></video>`
          : `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover" alt="${p.name}" loading="lazy">`)
      : `<span style="font-size:3.2rem">${emoji}</span>`;
    return `<div class="product-card" onclick="openModal(${p.id})">
      <div class="product-img-wrap">${mediaPart}</div>
      <div class="product-body">
        <div class="product-cat">${p.category_name || ""}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">${parseFloat(p.price).toFixed(2).replace(".", ",")} €</div>
        <span class="product-unit">/ ${p.unit || "unité"}</span>
      </div>
    </div>`;
  }).join("");
}

// ── MODAL ──
function openModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  tg.HapticFeedback.impactOccurred("light");

  const emoji = p.category_emoji || "🛍️";
  const isVid = p.image_url && /\.(mp4|webm|ogg)$/i.test(p.image_url);
  const modalMedia = p.image_url
    ? (isVid
        ? `<video src="${p.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" autoplay muted loop playsinline></video>`
        : `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" alt="${p.name}">`)
    : `<span style="font-size:5rem">${emoji}</span>`;

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-media">${modalMedia}</div>
    <div class="modal-cat">${p.category_name || ""}</div>
    <div class="modal-name">${p.name}</div>
    ${p.description ? `<div class="modal-desc">${p.description}</div>` : ""}
    <div class="modal-price">${parseFloat(p.price).toFixed(2).replace(".", ",")} €</div>
    <span class="modal-unit">par ${p.unit || "unité"} · Stock : ${p.stock}</span>
    <button class="modal-add-btn" onclick="addToCart(${p.id})" ${p.stock <= 0 ? "disabled" : ""}>
      ${p.stock <= 0 ? "Rupture de stock" : "Ajouter au panier"}
    </button>
  `;

  document.getElementById("modalOverlay").classList.add("open");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

// ── CART ──
function addToCart(productId) {
  const p = products.find(x => x.id === productId);
  if (!p || p.stock <= 0) return;
  const existing = cart.find(x => x.id === productId);
  if (existing) {
    if (existing.qty >= p.stock) { showToast("⚠️ Stock insuffisant"); return; }
    existing.qty++;
  } else {
    cart.push({ id: p.id, name: p.name, price: p.price, qty: 1, unit: p.unit, emoji: p.category_emoji || "🛍️" });
  }
  saveCart();
  updateCartBadge();
  showToast(`✅ ${p.name} ajouté`);
  tg.HapticFeedback.impactOccurred("medium");
  closeModal();
}

function updateQty(productId, delta) {
  const item = cart.find(x => x.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== productId);
  saveCart();
  updateCartBadge();
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(x => x.id !== productId);
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

  const itemsHtml = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-thumb" style="font-size:1.7rem">${item.emoji || "🛍️"}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${(item.price * item.qty).toFixed(2).replace(".", ",")} €</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn del" onclick="removeFromCart(${item.id})">🗑</button>
        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
    </div>`).join("");

  el.innerHTML = `
    <div class="cart-items">${itemsHtml}</div>
    <div class="cart-summary">
      <div class="summary-row"><span>Articles</span><span>${totalQty}</span></div>
      <div class="summary-row total"><span>Total</span><span>${totalPrice.toFixed(2).replace(".", ",")} €</span></div>
    </div>
    <button class="btn-checkout" onclick="checkout()">Passer la commande</button>
  `;
}

// ── CHECKOUT ──
async function checkout() {
  if (cart.length === 0) return;
  const user = tg.initDataUnsafe?.user || {};
  const telegramId = user.id || 0;

  const btn = document.querySelector(".btn-checkout");
  if (btn) { btn.disabled = true; btn.textContent = "Envoi..."; }

  try {
    const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);
    await apiPost("/api/miniapp/order", {
      telegram_id: telegramId,
      items: cart.map(i => ({
        product_id: i.id,
        quantity: i.qty,
        unit_price: i.price,
      })),
      total: totalPrice,
    });

    cart = [];
    saveCart();
    updateCartBadge();
    showToast("🎉 Commande envoyée !");
    setTimeout(() => switchTab("produits"), 1200);
  } catch(e) {
    showToast("❌ " + (e.message || "Erreur, réessaie"));
    if (btn) { btn.disabled = false; btn.textContent = "Passer la commande"; }
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
