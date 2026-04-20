import React, { useState } from 'react';
import Home from './pages/Home.jsx';
import CategoryProducts from './pages/CategoryProducts.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Cart from './pages/Cart.jsx';
import Orders from './pages/Orders.jsx';
import Profile from './pages/Profile.jsx';
import { useCart } from './hooks/useCart.js';
import { useTelegram } from './hooks/useTelegram.js';

export default function App() {
  const { items, addItem, removeItem, updateQty, clearCart, total, count } = useCart();
  const { telegramId, firstName } = useTelegram();
  const [tab, setTab] = useState('home');
  const [stack, setStack] = useState([]); // navigation stack
  const [toast, setToast] = useState(null);
  const [successOrderId, setSuccessOrderId] = useState(null);

  const navigate = (screen) => setStack(s => [...s, screen]);
  const goBack = () => setStack(s => s.slice(0, -1));

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleAddToCart = (product, qty) => {
    addItem(product, qty);
    showToast(`✅ ${product.name} ajouté!`);
  };

  const handleOrderSuccess = (orderId) => {
    setSuccessOrderId(orderId);
    setStack([]);
    setTab('orders');
    showToast(`🎉 Commande #${orderId} confirmée!`);
  };

  // Determine current screen
  const currentScreen = stack[stack.length - 1];

  // Render stacked screens
  if (currentScreen?.type === 'category') {
    return (
      <>
        <CategoryProducts
          category={currentScreen.data}
          onBack={goBack}
          onProductSelect={(p) => navigate({ type: 'product', data: p })}
          cartCount={count}
          onCartOpen={() => navigate({ type: 'cart' })}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  if (currentScreen?.type === 'product') {
    return (
      <>
        <ProductDetail
          product={currentScreen.data}
          onBack={goBack}
          onAddToCart={handleAddToCart}
          cartCount={count}
          onCartOpen={() => navigate({ type: 'cart' })}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  if (currentScreen?.type === 'cart') {
    return (
      <>
        <Cart
          items={items}
          onUpdateQty={updateQty}
          onRemove={removeItem}
          onClear={clearCart}
          total={total}
          onBack={goBack}
          onOrderSuccess={handleOrderSuccess}
          telegramId={telegramId}
        />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  if (currentScreen?.type === 'orders') {
    return (
      <>
        <Orders telegramId={telegramId} onBack={goBack} />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  // Main tab content
  const renderTab = () => {
    switch (tab) {
      case 'home':
        return (
          <Home
            onCategorySelect={(cat) => navigate({ type: 'category', data: cat })}
            onProductSelect={(p) => navigate({ type: 'product', data: p })}
            cartCount={count}
            onCartOpen={() => navigate({ type: 'cart' })}
          />
        );
      case 'orders':
        return <Orders telegramId={telegramId} onBack={() => setTab('home')} />;
      case 'profile':
        return <Profile onViewOrders={() => setTab('orders')} />;
      default:
        return null;
    }
  };

  return (
    <>
      {renderTab()}

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        <button className={`nav-btn ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>
          <span className="icon">🏠</span>
          Accueil
        </button>
        <button
          className="nav-btn"
          onClick={() => navigate({ type: 'cart' })}
          style={{ position: 'relative' }}
        >
          <span className="icon" style={{ position: 'relative', display: 'inline-block' }}>
            🛒
            {count > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -8,
                background: 'var(--green)', color: '#000',
                borderRadius: '50%', width: 18, height: 18,
                fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>{count}</span>
            )}
          </span>
          Panier
        </button>
        <button className={`nav-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          <span className="icon">📦</span>
          Commandes
        </button>
        <button className={`nav-btn ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
          <span className="icon">👤</span>
          Profil
        </button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
