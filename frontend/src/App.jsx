import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Users, MessageSquare, Settings, Leaf, Bell } from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Customers from './pages/Customers.jsx';
import Chat from './pages/Chat.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import './App.css';

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [wsData, setWsData] = useState(null);

  const handleWsMessage = useCallback((data) => {
    setWsData(data);
    if (data.type === 'new_order') {
      setPendingOrders(p => p + 1);
      setNotifications(n => [...n.slice(-9), {
        id: Date.now(), type: 'order',
        text: `Nouvelle commande #${data.order.id} (${data.order.total?.toFixed(2)}€)`,
        time: new Date()
      }]);
    }
    if (data.type === 'new_message') {
      setUnreadMessages(p => p + 1);
      setNotifications(n => [...n.slice(-9), {
        id: Date.now(), type: 'message',
        text: `Message de ${data.message.first_name || data.message.username || 'client'}`,
        time: new Date()
      }]);
    }
  }, []);

  const { send } = useWebSocket(handleWsMessage);

  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">
            <Leaf size={24} color="#4ade80" />
            <span className="sidebar-title">CBD Shop</span>
          </div>
          <nav className="sidebar-nav">
            <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
              <LayoutDashboard size={18} /> Dashboard
            </NavLink>
            <NavLink to="/orders" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
              <ShoppingCart size={18} />
              <span>Commandes</span>
              {pendingOrders > 0 && <span className="badge">{pendingOrders}</span>}
            </NavLink>
            <NavLink to="/products" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
              <Package size={18} /> Produits & Stock
            </NavLink>
            <NavLink to="/customers" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
              <Users size={18} /> Clients
            </NavLink>
            <NavLink to="/chat" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
              <MessageSquare size={18} />
              <span>Messages</span>
              {unreadMessages > 0 && <span className="badge badge-green">{unreadMessages}</span>}
            </NavLink>
          </nav>
          {notifications.length > 0 && (
            <div className="sidebar-notifications">
              <div className="notif-header"><Bell size={14} /> Récent</div>
              {notifications.slice(-3).reverse().map(n => (
                <div key={n.id} className={`notif-item ${n.type}`}>
                  {n.text}
                </div>
              ))}
            </div>
          )}
        </aside>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard wsData={wsData} onPendingChange={setPendingOrders} />} />
            <Route path="/orders" element={<Orders wsData={wsData} send={send} onPendingChange={setPendingOrders} />} />
            <Route path="/products" element={<Products wsData={wsData} />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/chat" element={<Chat wsData={wsData} send={send} onRead={() => setUnreadMessages(0)} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
