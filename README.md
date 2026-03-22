# 🌿 CBD Shop - Telegram Bot + Dashboard

Une application complète pour gérer une boutique CBD via Telegram avec un tableau de bord d'administration.

## Fonctionnalités

### 🤖 Bot Telegram
- Menu interactif avec catégories et produits
- Panier d'achat avec quantités
- Passage de commande avec gestion du stock
- Suivi des commandes en temps réel
- Chat direct avec l'équipe
- Notifications automatiques de statut

### 📊 Dashboard Admin
- **Vue d'ensemble** : statistiques, graphiques revenus/commandes sur 7 jours, top produits
- **Commandes** : liste filtrable, changement de statut (notifie automatiquement le client)
- **Produits & Stock** : CRUD complet, alertes stock faible, mise à jour rapide du stock
- **Clients** : liste avec historique et dépenses totales
- **Messages** : chat live avec les clients (WebSocket temps réel)

## Installation

### Prérequis
- Node.js 20+
- Un bot Telegram (créé via [@BotFather](https://t.me/BotFather))

### 1. Backend
```bash
cd backend
cp .env.example .env
# Éditez .env et ajoutez votre BOT_TOKEN
npm install
npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Docker (production)
```bash
cp backend/.env.example backend/.env
# Éditez backend/.env
docker-compose up -d
```

## Configuration

Créez `backend/.env` :
```env
BOT_TOKEN=votre_token_telegram
PORT=3001
DASHBOARD_URL=http://localhost:5173
```

## Accès

- **Dashboard** : http://localhost:5173
- **API** : http://localhost:3001/api
- **Bot Telegram** : Cherchez votre bot sur Telegram

## Architecture

```
├── backend/
│   ├── src/
│   │   ├── bot/        # Bot Telegram (grammy)
│   │   ├── api/        # REST API (Express)
│   │   ├── db/         # SQLite (better-sqlite3)
│   │   └── websocket/  # WS temps réel
│   └── data/           # Base de données (gitignore)
└── frontend/
    └── src/
        ├── pages/      # Dashboard, Orders, Products, Chat, Customers
        └── hooks/      # useApi, useWebSocket
```

## Données par défaut

13 produits pré-chargés dans 5 catégories :
- 🌸 Fleurs CBD (OG Kush, Amnesia, Purple Haze, White Widow)
- 💧 Huiles CBD (5%, 10%, 20%)
- 🟤 Résines CBD (Maroc, Liban)
- 🍵 Infusions (Relaxante, Sommeil)
- ✨ Cosmétiques (Crème, Baume)
