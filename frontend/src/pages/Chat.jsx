import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Radio, Users, Plus, X } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useLocation } from 'react-router-dom';

export default function Chat({ wsData, send, onRead }) {
  const [tab, setTab] = useState('chat'); // 'chat' | 'broadcast'
  const [conversations, setConversations] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState(null);
  const messagesEndRef = useRef(null);
  const location = useLocation();

  const fetchConversations = async () => {
    try { setConversations(await api.get('/messages')); } catch {}
  };

  const fetchUsers = async () => {
    try { setAllUsers(await api.get('/users')); } catch {}
  };

  useEffect(() => {
    fetchConversations();
    fetchUsers();
  }, []);

  // Handle navigation from Customers page
  useEffect(() => {
    const state = location.state;
    if (state?.userId) {
      const fakeUser = { id: state.userId, telegram_id: state.telegramId, first_name: state.name };
      openConversation(fakeUser);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  useEffect(() => {
    if (wsData?.type === 'new_message') {
      fetchConversations();
      if (activeUser && wsData.message.user_id === activeUser.id) {
        setMessages(prev => [...prev, wsData.message]);
      }
    }
    if (wsData?.type === 'message_sent') {
      if (activeUser && wsData.message.user_id === activeUser.id) {
        setMessages(prev => [...prev, wsData.message]);
      }
      fetchConversations();
    }
  }, [wsData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openConversation = async (userOrConv) => {
    setActiveUser(userOrConv);
    setShowUserPicker(false);
    setMessages([]);
    try {
      const msgs = await api.get(`/messages/${userOrConv.id}`);
      setMessages(msgs);
      await api.post(`/messages/read/${userOrConv.id}`, {});
      onRead?.();
      fetchConversations();
    } catch {}
  };

  const sendMessage = async () => {
    if (!text.trim() || !activeUser) return;
    send({ type: 'send_message', user_id: activeUser.id, telegram_id: activeUser.telegram_id, text: text.trim() });
    setText('');
  };

  const sendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const result = await api.post('/broadcast', { text: broadcastText.trim() });
      setBroadcastResult(result);
      setBroadcastText('');
    } catch (e) {
      setBroadcastResult({ error: e.message });
    } finally { setBroadcasting(false); }
  };

  const userName = (u) => u?.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u?.username || `ID ${u?.telegram_id}`;
  const userInitial = (u) => (u?.first_name || u?.username || '?')[0].toUpperCase();

  // Users not in conversations yet
  const usersNotInConv = allUsers.filter(u => !conversations.find(c => c.id === u.id));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Messages</div>
          <div className="page-subtitle">Chat & broadcast Telegram</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={tab === 'chat' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab('chat')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px' }}
          >
            <MessageSquare size={15} /> Messages
          </button>
          <button
            className={tab === 'broadcast' ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab('broadcast')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px' }}
          >
            <Radio size={15} /> Broadcast
          </button>
        </div>
      </div>

      {tab === 'broadcast' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>📢 Envoyer à tous les clients</div>
          <div className="text-muted text-sm" style={{ marginBottom: 16 }}>
            {allUsers.length} client(s) enregistré(s) vont recevoir ce message via le bot Telegram
          </div>
          <textarea
            value={broadcastText}
            onChange={e => setBroadcastText(e.target.value)}
            placeholder="Votre message pour tous les clients..."
            rows={5}
            style={{ width: '100%', borderRadius: 12, marginBottom: 12, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-primary"
              onClick={sendBroadcast}
              disabled={broadcasting || !broadcastText.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Radio size={15} />
              {broadcasting ? `Envoi en cours...` : `Envoyer à ${allUsers.length} client(s)`}
            </button>
            {broadcastResult && !broadcastResult.error && (
              <div style={{ color: '#4ade80', fontSize: 13 }}>
                ✅ Envoyé à {broadcastResult.sent}/{broadcastResult.total} clients
                {broadcastResult.failed > 0 && ` (${broadcastResult.failed} échecs)`}
              </div>
            )}
            {broadcastResult?.error && (
              <div style={{ color: '#f87171', fontSize: 13 }}>❌ {broadcastResult.error}</div>
            )}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div style={{ display: 'flex', height: 'calc(100vh - 160px)', gap: 16 }}>
          {/* Conversation list */}
          <div className="card" style={{ width: 280, minWidth: 280, overflow: 'auto', padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Conversations ({conversations.length})</span>
              <button
                className="btn-ghost"
                style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setShowUserPicker(v => !v)}
                title="Nouveau message"
              >
                <Plus size={14} /> Nouveau
              </button>
            </div>

            {/* New message user picker */}
            {showUserPicker && (
              <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>CONTACTER UN CLIENT</div>
                <div style={{ maxHeight: 200, overflow: 'auto' }}>
                  {allUsers.map(u => (
                    <div
                      key={u.id}
                      onClick={() => openConversation(u)}
                      style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#22263a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
                        {userInitial(u)}
                      </div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName(u)}</div>
                        {u.username && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{u.username}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto' }}>
              {conversations.length === 0 && !showUserPicker ? (
                <div className="text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
                  <MessageSquare size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
                  Aucun message reçu.<br/>Cliquez "+ Nouveau" pour contacter un client.
                </div>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => openConversation(conv)}
                    style={{
                      padding: '12px 16px', borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: activeUser?.id === conv.id ? 'var(--bg3)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#22263a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
                        {userInitial(conv)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex justify-between items-center">
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{userName(conv)}</span>
                          {conv.unread_count > 0 && (
                            <span style={{ background: '#4ade80', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                        <div className="text-muted text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                          {conv.from_admin ? '↩ Vous: ' : ''}{conv.last_message}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Message area */}
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0 }}>
            {!activeUser ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a7' }}>
                <div style={{ textAlign: 'center' }}>
                  <MessageSquare size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <div>Sélectionnez une conversation ou cliquez "+ Nouveau"</div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#6366f1' }}>
                    {userInitial(activeUser)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{userName(activeUser)}</div>
                    {activeUser.username && <div className="text-muted text-sm">@{activeUser.username}</div>}
                  </div>
                  <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setActiveUser(null)}>
                    <X size={16} />
                  </button>
                </div>

                <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {messages.length === 0 && (
                    <div className="text-muted text-sm" style={{ textAlign: 'center', marginTop: 40 }}>
                      Aucun message. Envoyez le premier message ci-dessous.
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.from_admin ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '10px 14px',
                        borderRadius: msg.from_admin ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        background: msg.from_admin ? 'var(--accent)' : 'var(--bg3)',
                        color: msg.from_admin ? 'white' : 'var(--text)', fontSize: 14
                      }}>
                        <div>{msg.text}</div>
                        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>
                          {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Tapez votre message... (Entrée pour envoyer)"
                    rows={2}
                    style={{ flex: 1, resize: 'none', borderRadius: 12 }}
                  />
                  <button
                    className="btn-primary"
                    onClick={sendMessage}
                    disabled={!text.trim()}
                    style={{ alignSelf: 'flex-end', padding: '10px 16px' }}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
