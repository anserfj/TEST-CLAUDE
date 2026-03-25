import React, { useState, useEffect } from 'react';
import { ShoppingCart, X, MessageSquare } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useNavigate } from 'react-router-dom';

const STATUS_LABEL = {
  pending: '⏳ En attente', confirmed: '✅ Confirmée', preparing: '👨‍🍳 Préparation',
  shipped: '🚚 Expédiée', delivered: '📬 Livrée', cancelled: '❌ Annulée'
};

export default function Customers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // user detail modal
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/users')
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const openUser = async (user) => {
    setSelected(user);
    setOrders([]);
    setLoadingOrders(true);
    try {
      const data = await api.get(`/users/${user.id}/orders`);
      setOrders(data);
    } catch (e) { console.error(e); }
    finally { setLoadingOrders(false); }
  };

  const filtered = users.filter(u => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(s) ||
      u.last_name?.toLowerCase().includes(s) ||
      u.username?.toLowerCase().includes(s)
    );
  });

  const userName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `ID ${u.telegram_id}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-subtitle">{users.length} client(s) enregistré(s)</div>
        </div>
        <input
          placeholder="Rechercher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="text-muted" style={{ padding: 40, textAlign: 'center' }}>Chargement...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Telegram ID</th>
                  <th>Commandes</th>
                  <th>Dépenses totales</th>
                  <th>Dernière activité</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => (
                  <tr key={user.id} style={{ cursor: 'pointer' }} onClick={() => openUser(user)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'var(--bg3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#6366f1', fontWeight: 700, fontSize: 13
                        }}>
                          {(user.first_name || user.username || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{userName(user)}</div>
                          {user.username && <div className="text-muted text-sm">@{user.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted text-sm">{user.telegram_id}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ShoppingCart size={14} color="#6366f1" />
                        <strong>{user.order_count}</strong>
                      </div>
                    </td>
                    <td><div style={{ color: '#4ade80', fontWeight: 600 }}>{parseFloat(user.total_spent || 0).toFixed(2)}€</div></td>
                    <td className="text-muted text-sm">{new Date(user.last_seen).toLocaleDateString('fr-FR')}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        className="btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => navigate('/chat', { state: { userId: user.id, telegramId: user.telegram_id, name: userName(user) } })}
                      >
                        <MessageSquare size={13} /> Message
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#8b90a7' }}>Aucun client trouvé</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal détail client ── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ maxWidth: 620, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {userName(selected)}
                {selected.username && <span className="text-muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>@{selected.username}</span>}
              </div>
              <button className="btn-ghost" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
                <div className="text-muted text-sm">Telegram ID</div>
                <div style={{ fontWeight: 600 }}>{selected.telegram_id}</div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
                <div className="text-muted text-sm">Commandes</div>
                <div style={{ fontWeight: 600, color: '#6366f1' }}>{selected.order_count}</div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
                <div className="text-muted text-sm">Total dépensé</div>
                <div style={{ fontWeight: 600, color: '#4ade80' }}>{parseFloat(selected.total_spent || 0).toFixed(2)}€</div>
              </div>
            </div>

            {selected.address && (
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                📍 {selected.address}
              </div>
            )}

            <div style={{ fontWeight: 600, marginBottom: 10 }}>Historique des commandes</div>
            {loadingOrders ? (
              <div className="text-muted" style={{ padding: 20, textAlign: 'center' }}>Chargement...</div>
            ) : orders.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: 20, textAlign: 'center' }}>Aucune commande</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflow: 'auto' }}>
                {orders.map(o => (
                  <div key={o.id} style={{ background: 'var(--bg3)', borderRadius: 10, padding: '12px 14px' }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: 600 }}>Commande #{o.id}</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 12 }}>{STATUS_LABEL[o.status] || o.status}</span>
                        <strong style={{ color: '#4ade80' }}>{parseFloat(o.total).toFixed(2)}€</strong>
                      </div>
                    </div>
                    <div className="text-muted text-sm" style={{ marginBottom: 6 }}>
                      {new Date(o.created_at).toLocaleString('fr-FR')}
                    </div>
                    {o.delivery_address && (
                      <div className="text-muted text-sm" style={{ marginBottom: 6 }}>📍 {o.delivery_address}</div>
                    )}
                    {o.items?.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {o.items.map((it, i) => (
                          <span key={i}>{it.name || `Produit`} ×{it.quantity}{it.unit} {i < o.items.length - 1 ? '· ' : ''}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-ghost" onClick={() => setSelected(null)}>Fermer</button>
              <button
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => { setSelected(null); navigate('/chat', { state: { userId: selected.id, telegramId: selected.telegram_id, name: userName(selected) } }); }}
              >
                <MessageSquare size={14} /> Envoyer un message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
