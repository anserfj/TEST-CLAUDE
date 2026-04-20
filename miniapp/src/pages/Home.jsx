import React, { useState, useEffect } from 'react';

const CATEGORY_EMOJIS = {
  'Fleurs CBD': '🌸',
  'Huiles CBD': '💧',
  'Résines CBD': '🟤',
  'Infusions': '🍵',
  'Cosmétiques': '✨'
};

export default function Home({ onCategorySelect, onProductSelect, cartCount, onCartOpen }) {
  const [categories, setCategories] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/products').then(r => r.json())
    ]).then(([cats, prods]) => {
      setCategories(cats.filter(c => c.active));
      setFeatured(prods.filter(p => p.active && p.stock > 0).slice(0, 4));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Chargement...</div>;

  return (
    <div className="page">
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">🌿 CBD Shop</div>
        <button className="topbar-cart-btn" onClick={onCartOpen}>
          🛒
          {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
        </button>
      </div>

      {/* Hero */}
      <div className="hero">
        <div className="hero-title">Bienvenue 🌿</div>
        <div className="hero-desc">
          Produits CBD premium, testés en laboratoire. Livraison rapide et discrète.
        </div>
        <div className="hero-badges">
          <span className="hero-badge">✅ Legal &lt;0.3% THC</span>
          <span className="hero-badge">🧪 Testé labo</span>
          <span className="hero-badge">🌱 100% naturel</span>
        </div>
      </div>

      {/* Categories */}
      <div className="section-title">Catégories</div>
      <div className="categories-grid">
        {categories.map(cat => {
          const emoji = CATEGORY_EMOJIS[cat.name] || cat.emoji || '🌿';
          return (
            <div
              key={cat.id}
              className="category-card"
              onClick={() => onCategorySelect(cat)}
            >
              <div className="category-emoji">{emoji}</div>
              <div className="category-name">{cat.name}</div>
            </div>
          );
        })}
      </div>

      {/* Featured products */}
      {featured.length > 0 && (
        <>
          <div className="section-title">Produits populaires</div>
          <div className="products-list">
            {featured.map(prod => (
              <ProductRow key={prod.id} product={prod} onClick={() => onProductSelect(prod)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ProductRow({ product, onClick }) {
  const emoji = getProductEmoji(product);
  const stockClass = product.stock > 10 ? 'stock-ok' : product.stock > 0 ? 'stock-low' : 'stock-out';
  const stockLabel = product.stock > 10 ? 'En stock' : product.stock > 0 ? `${product.stock} restants` : 'Rupture';

  return (
    <div className="product-row" onClick={onClick}>
      <div className="product-emoji">{emoji}</div>
      <div className="product-info">
        <div className="product-name">{product.name}</div>
        <div className="product-desc">{product.description}</div>
        <span className={`stock-badge ${stockClass}`}>{stockLabel}</span>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="product-price">{product.price?.toFixed(2)}€</div>
        <div className="product-unit">/ {product.unit}</div>
      </div>
    </div>
  );
}

export function getProductEmoji(product) {
  const name = product.name?.toLowerCase() || '';
  const cat = product.category_name?.toLowerCase() || '';
  if (cat.includes('fleur') || name.includes('fleur') || name.includes('kush') || name.includes('haze') || name.includes('widow') || name.includes('amnesia')) return '🌸';
  if (cat.includes('huile') || name.includes('huile')) return '💧';
  if (cat.includes('résine') || name.includes('résine') || name.includes('maroc') || name.includes('liban')) return '🟤';
  if (cat.includes('infusion') || name.includes('tisane')) return '🍵';
  if (cat.includes('cosmé') || name.includes('crème') || name.includes('baume')) return '✨';
  return '🌿';
}
