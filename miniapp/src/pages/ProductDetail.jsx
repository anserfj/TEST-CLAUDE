import React, { useState } from 'react';
import { getProductEmoji } from './Home.jsx';
import { useTelegram } from '../hooks/useTelegram.js';

export default function ProductDetail({ product, onBack, onAddToCart, cartCount, onCartOpen }) {
  const [qty, setQty] = useState(1);
  const { haptic } = useTelegram();
  const emoji = getProductEmoji(product);
  const inStock = product.stock > 0;

  const handleAdd = () => {
    haptic('medium');
    onAddToCart(product, qty);
    onBack();
  };

  return (
    <div className="page">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>‹</button>
        <div className="topbar-title">Détail produit</div>
        <button className="topbar-cart-btn" onClick={onCartOpen}>
          🛒
          {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
        </button>
      </div>

      {/* Hero */}
      <div className="product-detail-hero">
        <div className="product-detail-emoji">{emoji}</div>
        <div className="product-detail-name">{product.name}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green)' }}>
          {product.price?.toFixed(2)}€ <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--tg-hint)' }}>/ {product.unit}</span>
        </div>
      </div>

      <div className="product-detail-body">
        {/* Description */}
        {product.description && (
          <div style={{
            background: 'var(--tg-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            marginBottom: 16,
            border: '1px solid var(--border)',
            fontSize: 14,
            color: 'var(--tg-hint)',
            lineHeight: 1.6
          }}>
            {product.description}
          </div>
        )}

        {/* Info table */}
        <div style={{ background: 'var(--tg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 16 }}>
          {product.cbd_percent > 0 && (
            <div className="info-row" style={{ padding: '14px' }}>
              <span className="info-label">💚 Taux CBD</span>
              <span className="info-value">{product.cbd_percent}%</span>
            </div>
          )}
          {product.thc_percent > 0 && (
            <div className="info-row" style={{ padding: '14px' }}>
              <span className="info-label">⚪ Taux THC</span>
              <span className="info-value">&lt; {product.thc_percent}%</span>
            </div>
          )}
          <div className="info-row" style={{ padding: '14px' }}>
            <span className="info-label">📦 Stock</span>
            <span className={`info-value stock-badge ${product.stock > 10 ? 'stock-ok' : product.stock > 0 ? 'stock-low' : 'stock-out'}`}>
              {product.stock > 10 ? 'En stock' : product.stock > 0 ? `${product.stock} restants` : 'Rupture'}
            </span>
          </div>
          <div className="info-row" style={{ padding: '14px' }}>
            <span className="info-label">✅ Légalité</span>
            <span className="info-value" style={{ color: 'var(--green)' }}>Conforme UE</span>
          </div>
        </div>

        {/* Quantity selector */}
        {inStock && (
          <div style={{ background: 'var(--tg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: '14px', marginBottom: 80 }}>
            <div style={{ fontSize: 13, color: 'var(--tg-hint)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase' }}>Quantité</div>
            <div className="qty-selector">
              <button className="qty-btn" onClick={() => { haptic('light'); setQty(q => Math.max(1, q - 1)); }}>−</button>
              <span className="qty-value">{qty}</span>
              <button className="qty-btn" onClick={() => { haptic('light'); setQty(q => Math.min(product.stock, q + 1)); }}>+</button>
              <span style={{ color: 'var(--tg-hint)', fontSize: 14 }}>{product.unit}</span>
            </div>
          </div>
        )}
      </div>

      {/* Add to cart button */}
      {inStock ? (
        <button className="main-btn" onClick={handleAdd}>
          🛒 Ajouter au panier — {(product.price * qty).toFixed(2)}€
        </button>
      ) : (
        <button className="main-btn" disabled>
          ❌ Rupture de stock
        </button>
      )}
    </div>
  );
}
