import React, { useState, useEffect } from 'react';
import { ProductRow } from './Home.jsx';

export default function CategoryProducts({ category, onBack, onProductSelect, cartCount, onCartOpen }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(all => setProducts(all.filter(p => p.category_id === category.id && p.active)))
      .finally(() => setLoading(false));
  }, [category.id]);

  return (
    <div className="page">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>‹</button>
        <div className="topbar-title">{category.emoji} {category.name}</div>
        <button className="topbar-cart-btn" onClick={onCartOpen}>
          🛒
          {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
        </button>
      </div>

      {loading ? (
        <div className="loading">Chargement...</div>
      ) : products.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">😔</div>
          <div className="empty-title">Aucun produit</div>
          <div className="empty-desc">Cette catégorie est vide pour l'instant</div>
        </div>
      ) : (
        <div className="products-list" style={{ marginTop: 12 }}>
          {products.map(prod => (
            <ProductRow key={prod.id} product={prod} onClick={() => onProductSelect(prod)} />
          ))}
        </div>
      )}
    </div>
  );
}
