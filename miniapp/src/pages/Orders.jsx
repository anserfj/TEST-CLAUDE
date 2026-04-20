import React, { useState, useEffect } from 'react';

const STATUS = {
  pending:   { label: '⏳ En attente',      color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  confirmed: { label: '✅ Confirmée',        color: '#818cf8', bg: 'rgba(99,102,241,0.12)' },
  preparing: { label: '👨‍🍳 En préparation', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  shipped:   { label: '🚚 Expédiée',         color: '#a5b4fc', bg: 'rgba(165,180,252,0.12)' },
  delivered: { label: '📬 Livrée',           color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  cancelled: { label: '❌ Annulée',          color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

export default function Orders({ telegramId, onBack }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!telegramId) { setLoading(false); return; }
    fetch(`/api/miniapp/orders/${telegramId}`)
      .then(r => r.json())
      .then(setOrders)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [telegramId]);

  return (
    <div className="page">
      <div className="topbar">
        <button className="topbar-back" onClick={onBack}>‹</button>
        <div className="topbar-title">Mes Commandes</div>
      </div>

      {loading ? (
        <div className="loading">Chargement...</div>
      ) : !telegramId ? (
        <div className="empty">
          <div className="empty-emoji">🔒</div>
          <div className="empty-title">Non disponible</div>
          <div className="empty-desc">Ouvrez cette app depuis Telegram</div>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">📦</div>
          <div className="empty-title">Aucune commande</div>
          <div className="empty-desc">Vos commandes apparaîtront ici</div>
        </div>
      ) : (
        <div className="orders-list" style={{ marginTop: 12 }}>
          {orders.map(order => {
            const s = STATUS[order.status] || STATUS.pending;
            return (
              <div key={order.id} className="order-card">
                <div className="order-header">
                  <span className="order-id">Commande #{order.id}</span>
                  <span className="order-date">
                    {new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="order-status" style={{ color: s.color, background: s.bg }}>
                  {s.label}
                </div>
                {order.items && (
                  <div className="order-items-preview">
                    {order.items.slice(0, 2).map(i => `${i.name} x${i.quantity}`).join(', ')}
                    {order.items.length > 2 ? ` +${order.items.length - 2} autres` : ''}
                  </div>
                )}
                <div className="order-total">{order.total?.toFixed(2)}€</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
