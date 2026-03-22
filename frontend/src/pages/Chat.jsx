import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function Chat({ wsData, send, onRead }) {
  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  const fetchConversations = async () => {
    try {
      const data = await api.get('/messages');
      setConversations(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

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

  const openConversation = async (conv) => {
    setActiveUser(conv);
    const msgs = await api.get(`/messages/${conv.id}`);
    setMessages(msgs);
    await api.post(`/messages/read/${conv.id}`, {});
    onRead?.();
    fetchConversations();
  };

  const sendMessage = async () => {
    if (!text.trim() || !activeUser) return;
    send({
      type: 'send_message',
      user_id: activeUser.id,
      telegram_id: activeUser.telegram_id,
      text: text.trim()
    });
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const userName = (u) => u?.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u?.username || `User ${u?.telegram_id}`;
  const userInitial = (u) => (u?.first_name || u?.username || '?')[0].toUpperCase();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Messages</div>
          <div className="page-subtitle">Chat avec les clients Telegram</div>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 140px)', gap: 16 }}>
        {/* Conversation list */}
        <div className="card" style={{ width: 280, minWidth: 280, overflow: 'auto', padding: 0 }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            Conversations ({conversations.length})
          </div>
          {conversations.length === 0 ? (
            <div className="text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
              <MessageSquare size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
              Aucun message reçu
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => openConversation(conv)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: activeUser?.id === conv.id ? 'var(--bg3)' : 'transparent',
                  transition: 'background 0.15s'
                }}
              >
                <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: '#22263a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, color: '#6366f1', flexShrink: 0
                  }}>
                    {userInitial(conv)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex justify-between items-center">
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{userName(conv)}</span>
                      {conv.unread_count > 0 && (
                        <span style={{
                          background: '#4ade80', color: '#000',
                          borderRadius: 10, padding: '1px 7px',
                          fontSize: 11, fontWeight: 700, flexShrink: 0
                        }}>
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

        {/* Message area */}
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0 }}>
          {!activeUser ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a7' }}>
              <div style={{ textAlign: 'center' }}>
                <MessageSquare size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <div>Sélectionnez une conversation</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--bg3)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 700, color: '#6366f1'
                }}>
                  {userInitial(activeUser)}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{userName(activeUser)}</div>
                  {activeUser.username && <div className="text-muted text-sm">@{activeUser.username}</div>}
                </div>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messages.map((msg, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: msg.from_admin ? 'flex-end' : 'flex-start'
                  }}>
                    <div style={{
                      maxWidth: '70%',
                      padding: '10px 14px',
                      borderRadius: msg.from_admin ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: msg.from_admin ? 'var(--accent)' : 'var(--bg3)',
                      color: msg.from_admin ? 'white' : 'var(--text)',
                      fontSize: 14
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
                  onKeyDown={handleKeyDown}
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
    </div>
  );
}
