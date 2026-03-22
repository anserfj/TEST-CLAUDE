import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ShoppingCart, Users, TrendingUp, AlertTriangle, MessageSquare, Package } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function Dashboard({ wsData, onPendingChange }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const data = await api.get('/stats');
      setStats(data);
      onPendingChange?.(data.pendingOrders);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => {
    if (wsData?.type === 'new_order' || wsData?.type === 'order_updated') fetchStats();
  }, [wsData]);

  if (loading) return <div className="text-muted">Chargement...</div>;
  if (!stats) return <div className="text-muted">Erreur de chargement</div>;

  const chartData = stats.recentOrders.map(d => ({
    date: new Date(d.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
    Commandes: d.count,
    Revenus: parseFloat(d.revenue?.toFixed(2) || 0)
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Vue d'ensemble de votre boutique</div>
        </div>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><ShoppingCart size={14} /> Commandes totales</div>
          <div className="stat-value accent">{stats.totalOrders}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><TrendingUp size={14} /> Revenus totaux</div>
          <div className="stat-value green">{stats.totalRevenue?.toFixed(2)}€</div>
        </div>
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><ShoppingCart size={14} /> En attente</div>
          <div className={`stat-value ${stats.pendingOrders > 0 ? 'yellow' : 'green'}`}>{stats.pendingOrders}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><Users size={14} /> Clients</div>
          <div className="stat-value accent">{stats.totalUsers}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><AlertTriangle size={14} /> Stock faible</div>
          <div className={`stat-value ${stats.lowStock > 0 ? 'red' : 'green'}`}>{stats.lowStock}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label flex gap-2 items-center"><MessageSquare size={14} /> Messages non lus</div>
          <div className={`stat-value ${stats.unreadMessages > 0 ? 'yellow' : 'green'}`}>{stats.unreadMessages}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 16 }}>Commandes (7 derniers jours)</div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e3347" />
                <XAxis dataKey="date" tick={{ fill: '#8b90a7', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8b90a7', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8 }} />
                <Bar dataKey="Commandes" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted" style={{ textAlign: 'center', padding: 40 }}>Aucune donnée</div>
          )}
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 16 }}>Revenus (7 derniers jours)</div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e3347" />
                <XAxis dataKey="date" tick={{ fill: '#8b90a7', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8b90a7', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 8 }} formatter={(v) => `${v}€`} />
                <Bar dataKey="Revenus" fill="#4ade80" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted" style={{ textAlign: 'center', padding: 40 }}>Aucune donnée</div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 16 }}>
          <Package size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
          Top Produits
        </div>
        {stats.topProducts.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Vendus</th>
                <th>Revenus</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProducts.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td>{p.sold}</td>
                  <td style={{ color: '#4ade80' }}>{p.revenue?.toFixed(2)}€</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted">Aucune vente pour l'instant</div>
        )}
      </div>
    </div>
  );
}
