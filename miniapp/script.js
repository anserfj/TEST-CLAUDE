// ================================================
// BALTIMORE 83 — script.js
// ================================================

const SUPABASE_URL = "https://lkgyrqfdefwrmdvukmpl.supabase.co";
const SUPABASE_KEY = "sb_publishable_5eOyGWb80AcDLt-DSC7POA_blD_KhIZ";
const SB_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

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

const isVideo = url => url && /\.(mp4|webm|mov|avi)(\?|$)/i.test(url);

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

// ── SUPABASE ──
async function sbGet(table, params = "") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
}

// ── INIT ──
async function init() {
  loadCart();
  showSkeletons();
  try {
    const data = await sbGet("products", "?order=id.asc");
    products = data.map(p => ({
      ...p,
      price: parseFloat(p.price),
      gouts: Array.isArray(p.gouts) ? p.gouts : (p.gouts ? JSON.parse(p.gouts) : []),
      description: p.description || "",
    }));
  } catch(e) {
    console.warn("Supabase indispo:", e);
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
    const matchCat = currentFilter === "tous" || p.category === currentFilter;
    const matchSearch = !currentSearch ||
      p.name?.toLowerCase().includes(currentSearch) ||
      p.description?.toLowerCase().includes(currentSearch);
    return matchCat && matchSearch && p.active !== false;
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
    const medias = Array.isArray(p.medias) ? p.medias :
      (p.medias ? (typeof p.medias === "string" ? JSON.parse(p.medias) : p.medias) : []);
    const thumb = medias[0];
    const mediaHtml = thumb
      ? (isVideo(thumb.url || thumb)
          ? `<video src="${thumb.url || thumb}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
          : `<img src="${thumb.url || thumb}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`)
      : `<span style="font-size:3rem">🛍️</span>`;

    const badge = p.badge === "new" ? `<span class="product-badge badge-new">Nouveau</span>`
      : p.badge === "promo" ? `<span class="product-badge badge-promo">Promo</span>`
      : p.badge === "top" ? `<span class="product-badge badge-top">Top</span>` : "";

    return `<div class="product-card" onclick="openModal(${p.id})">
      <div class="product-img-wrap">
        ${badge}
        ${mediaHtml}
      </div>
      <div class="product-body">
        <div class="product-cat">${p.category || ""}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">${parseFloat(p.price).toFixed(2).replace(".", ",")} €</div>
        ${p.min_qty ? `<span class="product-unit">Min. ${p.min_qty} unités</span>` : ""}
      </div>
    </div>`;
  }).join("");
}

// ── MODAL ──
function openModal(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  tg.HapticFeedback.impactOccurred("light");

  const medias = Array.isArray(p.medias) ? p.medias :
    (p.medias ? (typeof p.medias === "string" ? JSON.parse(p.medias) : p.medias) : []);
  const thumb = medias[0];
  const mediaHtml = thumb
    ? (isVideo(thumb.url || thumb)
        ? `<video src="${thumb.url || thumb}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
        : `<img src="${thumb.url || thumb}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;display:block">`)
    : `<span style="font-size:5rem">🛍️</span>`;

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-media">${mediaHtml}</div>
    <div class="modal-cat">${p.category || ""}</div>
    <div class="modal-name">${p.name}</div>
    ${p.description ? `<div class="modal-desc">${p.description}</div>` : ""}
    <div class="modal-price">${parseFloat(p.price).toFixed(2).replace(".", ",")} €</div>
    ${p.min_qty ? `<span class="modal-unit">Minimum ${p.min_qty} unités</span>` : ""}
    <button class="modal-add-btn" onclick="addToCart(${p.id})">
      Ajouter au panier
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
  if (!p) return;
  const existing = cart.find(x => x.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: p.id, name: p.name, price: p.price, qty: 1, medias: p.medias });
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

  const itemsHtml = cart.map(item => {
    const medias = Array.isArray(item.medias) ? item.medias :
      (item.medias ? (typeof item.medias === "string" ? JSON.parse(item.medias) : item.medias) : []);
    const thumb = medias[0];
    const thumbHtml = thumb
      ? (isVideo(thumb.url || thumb)
          ? `<video src="${thumb.url || thumb}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;border-radius:8px"></video>`
          : `<img src="${thumb.url || thumb}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`)
      : `🛍️`;

    return `<div class="cart-item">
      <div class="cart-item-thumb">${thumbHtml}</div>
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

// ── CHECKOUT ──
async function checkout() {
  if (cart.length === 0) return;
  const user = tg.initDataUnsafe?.user || {};
  const username = user.username || user.first_name || "Anonyme";
  const userId = user.id || 0;

  try {
    await sbPost("orders", {
      telegram_id: userId,
      username: username,
      items: JSON.stringify(cart),
      total: cart.reduce((s, i) => s + i.price * i.qty, 0),
      status: "nouveau",
    });

    const msg = `🛒 *Nouvelle commande*\n👤 @${username}\n\n` +
      cart.map(i => `• ${i.name} x${i.qty} — ${(i.price * i.qty).toFixed(2)}€`).join("\n") +
      `\n\n💰 *Total: ${cart.reduce((s,i)=>s+i.price*i.qty,0).toFixed(2)}€*`;

    tg.sendData(msg);
    cart = [];
    saveCart();
    updateCartBadge();
    showToast("🎉 Commande envoyée !");
    setTimeout(() => switchTab("produits"), 1200);
  } catch(e) {
    showToast("❌ Erreur, réessaie");
    console.error(e);
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
