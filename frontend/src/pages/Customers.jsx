import React, { useState, useEffect } from 'react';
import { User, ShoppingCart, TrendingUp } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function Customers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/users')
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(u => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(s) ||
      u.last_name?.toLowerCase().includes(s) ||
      u.username?.toLowerCase().includes(s)
    );
  });

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
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => (
                  <tr key={user.id}>
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
                          <div style={{ fontWeight: 500 }}>
                            {user.first_name} {user.last_name}
                          </div>
                          {user.username && <div className="text-muted text-sm">@{user.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted text-sm">{user.telegram_id}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ShoppingCart size={14} color="#6366f1" />
                        {user.order_count}
                      </div>
                    </td>
                    <td>
                      <div style={{ color: '#4ade80', fontWeight: 600 }}>
                        {parseFloat(user.total_spent || 0).toFixed(2)}€
                      </div>
                    </td>
                    <td className="text-muted text-sm">
                      {new Date(user.last_seen).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#8b90a7' }}>
                    Aucun client trouvé
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
