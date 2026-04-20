import React from 'react';
import { useTelegram } from '../hooks/useTelegram.js';

export default function Profile({ onViewOrders }) {
  const { user, firstName, username, isInTelegram } = useTelegram();
  const initial = (firstName || '?')[0].toUpperCase();

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbar-title">Mon Profil</div>
      </div>

      <div className="profile-header">
        <div className="profile-avatar">{initial}</div>
        <div>
          <div className="profile-name">{firstName} {user?.last_name || ''}</div>
          {username && <div className="profile-handle">@{username}</div>}
          {!isInTelegram && <div className="profile-handle" style={{ color: '#fbbf24' }}>Mode aperçu</div>}
        </div>
      </div>

      <div className="profile-menu">
        <div className="profile-menu-item" onClick={onViewOrders}>
          <span className="profile-menu-icon">📦</span>
          <span>Mes commandes</span>
          <span style={{ marginLeft: 'auto', color: 'var(--tg-hint)' }}>›</span>
        </div>

        <div className="profile-menu-item" style={{ cursor: 'default' }}>
          <span className="profile-menu-icon">ℹ️</span>
          <div>
            <div>À propos</div>
            <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginTop: 2 }}>
              Tous produits &lt;0.3% THC · Testés labo · UE
            </div>
          </div>
        </div>

        <div className="profile-menu-item" style={{ cursor: 'default' }}>
          <span className="profile-menu-icon">📍</span>
          <div>
            <div>Notre boutique</div>
            <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginTop: 2 }}>
              12 Rue des Fleurs, Paris · Lun-Sam 10h-19h
            </div>
          </div>
        </div>

        <div style={{
          marginTop: 24,
          padding: '14px',
          background: 'var(--tg-secondary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--tg-hint)',
          lineHeight: 1.6,
          textAlign: 'center'
        }}>
          🌿 CBD Shop v1.0<br />
          Nos produits ne sont pas des médicaments<br />
          et ne remplacent pas un avis médical.
        </div>
      </div>
    </div>
  );
}
