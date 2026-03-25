import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, X, AlertTriangle, Upload } from 'lucide-react';
import { api } from '../hooks/useApi.js';

const UNITS = ['g', 'kg', 'flacon', 'sachet', 'tube', 'pot', 'unité'];

export default function Products({ wsData }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editProd, setEditProd] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filterCat, setFilterCat] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchAll = async () => {
    const [prods, cats] = await Promise.all([api.get('/products'), api.get('/categories')]);
    setProducts(prods);
    setCategories(cats);
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = filterCat
    ? products.filter(p => p.category_id === parseInt(filterCat))
    : products;

  const openEdit = (prod) => { setEditProd({ ...prod }); setShowForm(true); };
  const openNew = () => {
    setEditProd({
      name: '', description: '', price: '', stock: 0, unit: 'g',
      thc_percent: 0, cbd_percent: 0, active: true,
      category_id: categories[0]?.id || ''
    });
    setShowForm(true);
  };

  const handleMediaUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      setEditProd(p => ({ ...p, image_url: url }));
    } catch {
      alert('Erreur upload. Max 100MB, formats: jpg, png, gif, webp, mp4, webm');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    try {
      if (editProd.id) {
        await api.put(`/products/${editProd.id}`, editProd);
      } else {
        await api.post('/products', editProd);
      }
      setShowForm(false);
      fetchAll();
    } catch (e) {
      alert('Erreur lors de la sauvegarde');
    }
  };

  const updateStock = async (prodId, newStock) => {
    await api.patch(`/products/${prodId}/stock`, { stock: newStock });
    setProducts(prev => prev.map(p => p.id === prodId ? { ...p, stock: newStock } : p));
  };

  const deactivate = async (prodId) => {
    if (!confirm('Désactiver ce produit?')) return;
    await api.delete(`/products/${prodId}`);
    fetchAll();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Produits & Stock</div>
          <div className="page-subtitle">{products.filter(p => p.active).length} produits actifs</div>
        </div>
        <div className="flex gap-2 items-center">
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Toutes catégories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
          <button className="btn-primary flex gap-2 items-center" onClick={openNew}>
            <Plus size={16} /> Ajouter
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Catégorie</th>
                <th>CBD / THC</th>
                <th>Prix</th>
                <th>Stock</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(prod => (
                <tr key={prod.id} style={{ opacity: prod.active ? 1 : 0.5 }}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{prod.name}</div>
                    {prod.description && <div className="text-muted text-sm">{prod.description.slice(0, 50)}...</div>}
                  </td>
                  <td>
                    <span>{prod.category_emoji} {prod.category_name}</span>
                  </td>
                  <td className="text-sm text-muted">
                    {prod.cbd_percent > 0 && <div>💚 {prod.cbd_percent}% CBD</div>}
                    {prod.thc_percent > 0 && <div>⚪ &lt;{prod.thc_percent}% THC</div>}
                  </td>
                  <td><strong>{prod.price?.toFixed(2)}€</strong><span className="text-muted text-sm">/{prod.unit}</span></td>
                  <td>
                    <div className="flex items-center gap-2">
                      {prod.stock <= 5 && prod.active && <AlertTriangle size={14} color="#f87171" />}
                      <input
                        type="number" min="0"
                        value={prod.stock}
                        onChange={e => updateStock(prod.id, parseInt(e.target.value) || 0)}
                        style={{ width: 70, padding: '4px 8px', textAlign: 'center' }}
                      />
                    </div>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 12,
                      background: prod.active ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                      color: prod.active ? '#4ade80' : '#f87171'
                    }}>
                      {prod.active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn-ghost" onClick={() => openEdit(prod)} style={{ padding: '4px 8px' }}>
                        <Edit2 size={14} />
                      </button>
                      {prod.active && (
                        <button className="btn-danger" onClick={() => deactivate(prod.id)} style={{ padding: '4px 8px' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && editProd && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editProd.id ? 'Modifier le produit' : 'Nouveau produit'}</div>
              <button className="btn-ghost" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>

            <div className="form-group">
              <label className="form-label">Nom</label>
              <input value={editProd.name} onChange={e => setEditProd({...editProd, name: e.target.value})} />
            </div>

            <div className="form-group">
              <label className="form-label">Catégorie</label>
              <select value={editProd.category_id} onChange={e => setEditProd({...editProd, category_id: parseInt(e.target.value)})}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                value={editProd.description || ''}
                onChange={e => setEditProd({...editProd, description: e.target.value})}
                rows={3}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Prix (€)</label>
                <input type="number" step="0.01" min="0" value={editProd.price}
                  onChange={e => setEditProd({...editProd, price: parseFloat(e.target.value)})} />
              </div>
              <div className="form-group">
                <label className="form-label">Unité</label>
                <select value={editProd.unit} onChange={e => setEditProd({...editProd, unit: e.target.value})}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Stock</label>
                <input type="number" min="0" value={editProd.stock}
                  onChange={e => setEditProd({...editProd, stock: parseInt(e.target.value) || 0})} />
              </div>
              <div className="form-group">
                <label className="form-label">CBD %</label>
                <input type="number" step="0.1" min="0" value={editProd.cbd_percent}
                  onChange={e => setEditProd({...editProd, cbd_percent: parseFloat(e.target.value) || 0})} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">THC % (max 0.3)</label>
                <input type="number" step="0.1" min="0" max="0.3" value={editProd.thc_percent}
                  onChange={e => setEditProd({...editProd, thc_percent: parseFloat(e.target.value) || 0})} />
              </div>
              <div className="form-group" style={{ paddingTop: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editProd.active}
                    onChange={e => setEditProd({...editProd, active: e.target.checked})}
                    style={{ width: 'auto' }} />
                  <span>Produit actif</span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Photo / Vidéo</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/ogg"
                style={{ display: 'none' }}
                onChange={e => handleMediaUpload(e.target.files[0])}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content' }}
                >
                  <Upload size={15} />
                  {uploading ? 'Upload en cours...' : 'Choisir un fichier'}
                </button>
                {editProd.image_url && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/\.(mp4|webm|ogg|mov)$/i.test(editProd.image_url)
                      ? <video src={editProd.image_url} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} muted loop />
                      : <img src={editProd.image_url} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} alt="" />
                    }
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setEditProd(p => ({ ...p, image_url: null }))}
                      style={{ color: '#f87171', padding: '2px 6px', fontSize: 12 }}
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="btn-primary" onClick={save} disabled={uploading}>
                {editProd.id ? 'Sauvegarder' : 'Créer le produit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
