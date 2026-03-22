import React, { useState } from 'react';
import { getProductEmoji } from './Home.jsx';
import { useTelegram } from '../hooks/useTelegram.js';

export default function Cart({ items, onUpdateQty, onRemove, onClear, total, onBack, onOrderSuccess, telegramId }) {
  const [ordering, setOrdering] = useState(false);
  const [notes, setNotes] = useState('');
  const { haptic } = useTelegram();

  const handleOrder = async () => {
    if (!items.length) return;
    setOrdering(true);
    haptic('medium');

    try {
      const res = await fetch('/api/miniapp/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramId,
          items: items.map(i => ({ product_id: i.id, quantity: i.qty, unit_price: i.price })),
          notes,
          total
        })
      });
      const data = await res.json();
      if (res.ok) {
        onClear();
        onOrderSuccess(data.order_id);
      } else {
        alert(data.error || 'Erreur lors de la commande');
      }
    } catch (e) {
      alert('Erreur réseau, réessayez');
    } finally {
      setOrdering(false);
    }
  };

  if (!items.length) {
    return (
      <div className="page">
        <div className="topbar">
          <button className="topbar-back" onClick={onBack}>‹</button>
          <div className="topbar-title">Mon Panier</div>
        </div>
        <div className="empty">
          <div className="empty-emoji">🛒</div>
          <div className="empty-title">Panier vide</div>
          <div className="empty-desc">Ajoutez des produits depuis la boutique</div>
          <button
            onClick={onBack}
            style={{
              marginTop: 16,
              background: 'var(--green)',
              color: '#000',
              fontWeight: 700,
              padding: '12px 24px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 15
            }}
          >
            🛍️ Parcourir la boutique
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>‹</button>
        <div className="topbar-title">Mon Panier ({items.length})</div>
        <button
          onClick={() => { haptic('light'); onClear(); }}
          style={{ background: 'none', color: '#f87171', fontSize: 13, fontWeight: 600 }}
        >
          Vider
        </button>
      </div>

      <div className="cart-list" style={{ marginTop: 12 }}>
        {items.map(item => (
          <div key={item.id} className="cart-item">
            <div className="cart-item-emoji">{getProductEmoji(item)}</div>
            <div className="cart-item-info">
              <div className="cart-item-name">{item.name}</div>
              <div className="cart-item-price">{item.price?.toFixed(2)}€ / {item.unit}</div>
              <div style={{ color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>
                {(item.price * item.qty).toFixed(2)}€
              </div>
            </div>
            <div className="cart-item-actions">
              <button className="cart-qty-btn" onClick={() => { haptic('light'); onUpdateQty(item.id, item.qty - 1); }}>−</button>
              <span className="cart-qty">{item.qty}</span>
              <button className="cart-qty-btn" onClick={() => { haptic('light'); onUpdateQty(item.id, item.qty + 1); }}>+</button>
            </div>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div style={{ padding: '0 16px', marginTop: 8 }}>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes pour la commande (optionnel)..."
          rows={2}
          style={{
            width: '100%',
            background: 'var(--tg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--tg-text)',
            padding: '12px',
            fontSize: 14,
            resize: 'none',
            fontFamily: 'inherit'
          }}
        />
      </div>

      {/* Total */}
      <div className="cart-total">
        <div className="cart-total-row">
          <span style={{ color: 'var(--tg-hint)' }}>Sous-total</span>
          <span>{total.toFixed(2)}€</span>
        </div>
        <div className="cart-total-row">
          <span style={{ color: 'var(--tg-hint)' }}>Livraison</span>
          <span style={{ color: 'var(--green)' }}>Gratuite</span>
        </div>
        <div className="cart-total-row" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
          <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--green)' }}>{total.toFixed(2)}€</span>
        </div>
      </div>

      {/* Order button */}
      <button className="main-btn" onClick={handleOrder} disabled={ordering}>
        {ordering ? '⏳ Commande en cours...' : `✅ Commander — ${total.toFixed(2)}€`}
      </button>
    </div>
  );
}
