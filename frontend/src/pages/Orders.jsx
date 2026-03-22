import React, { useState, useEffect } from 'react';
import { Eye, RefreshCw, X } from 'lucide-react';
import { api } from '../hooks/useApi.js';

const STATUS_OPTIONS = [
  { value: 'pending', label: '⏳ En attente' },
  { value: 'confirmed', label: '✅ Confirmée' },
  { value: 'preparing', label: '👨‍🍳 En préparation' },
  { value: 'shipped', label: '🚚 Expédiée' },
  { value: 'delivered', label: '📬 Livrée' },
  { value: 'cancelled', label: '❌ Annulée' }
];

export default function Orders({ wsData, send, onPendingChange }) {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    try {
      const params = filter ? `?status=${filter}` : '';
      const data = await api.get(`/orders${params}`);
      setOrders(data.orders);
      setTotal(data.total);
      onPendingChange?.(data.orders.filter(o => o.status === 'pending').length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [filter]);
  useEffect(() => {
    if (wsData?.type === 'new_order') {
      fetchOrders();
    }
    if (wsData?.type === 'order_updated') {
      setOrders(prev => prev.map(o =>
        o.id === wsData.order_id ? { ...o, status: wsData.status } : o
      ));
    }
  }, [wsData]);

  const updateStatus = async (orderId, status) => {
    try {
      await api.patch(`/orders/${orderId}/status`, { status });
      // Also send via WS to notify the user
      send({ type: 'update_order_status', order_id: orderId, status });
      fetchOrders();
      if (selected?.id === orderId) setSelected({ ...selected, status });
    } catch (e) {
      alert('Erreur lors de la mise à jour');
    }
  };

  const openOrder = async (order) => {
    const detail = await api.get(`/orders/${order.id}`);
    setSelected(detail);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Commandes</div>
          <div className="page-subtitle">{total} commande(s) au total</div>
        </div>
        <div className="flex gap-2 items-center">
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Tous les statuts</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="btn-ghost" onClick={fetchOrders}><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="text-muted" style={{ padding: 40, textAlign: 'center' }}>Chargement...</div>
          ) : orders.length === 0 ? (
            <div className="text-muted" style={{ padding: 40, textAlign: 'center' }}>Aucune commande</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#ID</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Articles</th>
                  <th>Total</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id}>
                    <td><strong>#{order.id}</strong></td>
                    <td>
                      <div>{order.first_name} {order.last_name}</div>
                      {order.username && <div className="text-muted text-sm">@{order.username}</div>}
                    </td>
                    <td className="text-muted text-sm">
                      {new Date(order.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td>{order.item_count}</td>
                    <td><strong style={{ color: '#4ade80' }}>{order.total?.toFixed(2)}€</strong></td>
                    <td>
                      <select
                        value={order.status}
                        onChange={e => updateStatus(order.id, e.target.value)}
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="btn-ghost" onClick={() => openOrder(order)} style={{ padding: '4px 8px' }}>
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Commande #{selected.id}</div>
              <button className="btn-ghost" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="text-muted text-sm">Client</div>
              <div>{selected.first_name} {selected.last_name}</div>
              {selected.username && <div className="text-muted text-sm">@{selected.username}</div>}
              {selected.phone && <div className="text-muted text-sm">📞 {selected.phone}</div>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="text-muted text-sm" style={{ marginBottom: 8 }}>Articles</div>
              <table>
                <thead>
                  <tr><th>Produit</th><th>Qté</th><th>Prix</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {selected.items?.map(item => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{item.unit_price?.toFixed(2)}€</td>
                      <td style={{ color: '#4ade80' }}>{item.subtotal?.toFixed(2)}€</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ textAlign: 'right', marginTop: 12, fontWeight: 700, color: '#4ade80' }}>
                Total: {selected.total?.toFixed(2)}€
              </div>
            </div>

            <div className="form-group">
              <div className="form-label">Changer le statut</div>
              <select
                value={selected.status}
                onChange={e => { updateStatus(selected.id, e.target.value); setSelected({...selected, status: e.target.value}); }}
              >
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {selected.notes && (
              <div className="form-group">
                <div className="form-label">Notes</div>
                <div style={{ color: '#8b90a7' }}>{selected.notes}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
