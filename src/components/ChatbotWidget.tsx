import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, Loader } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.js';
import { useAuth } from '../context/AuthContext.js';

// Falls back to a lucide icon if this is ever unset, so the widget stays functional either way.
const AVATAR_SRC: string | null = '/chatbot-avatar.png';
// The source photo is a wide shot with the robot's face left-of-center - this keeps the face
// (not the laptop/background) centered when cropped into a small circular avatar.
const AVATAR_POSITION = '30% 22%';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSource {
  source_type: string;
  source_id: number;
  relevance: number;
}

function Avatar({ size = 'w-9 h-9' }: { size?: string }) {
  if (AVATAR_SRC) {
    return (
      <img
        src={AVATAR_SRC}
        alt="Tejoma AI Assistant"
        style={{ objectPosition: AVATAR_POSITION }}
        className={`${size} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${size} rounded-full bg-[#2962FF] flex items-center justify-center flex-shrink-0`}>
      <Bot className="w-5 h-5 text-white" />
    </div>
  );
}

const GREETING: ChatMessage = {
  role: 'assistant',
  content: "Hi! I'm the Tejoma AI Assistant. Ask me about your candidates or open positions - e.g. \"Who has SAP FICO experience?\" or \"How many open jobs do we have?\"",
};

export default function ChatbotWidget() {
  const { isAuthenticated, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastSources, setLastSources] = useState<ChatSource[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Chat is a recruiter/admin tool (matches the backend's requireRole('recruiter', 'admin') on
  // /api/chat) - don't render it for other roles or logged-out users.
  if (!isAuthenticated || (role !== 'recruiter' && role !== 'admin' && role !== 'superadmin')) {
    return null;
  }

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setLastSources([]);

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          // Only send prior turns (exclude the message just added) as conversational history.
          history: messages.slice(-10),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat request failed');

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setLastSources(data.sources || []);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating launcher button - bottom right, blinking pulse ring when closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Tejoma AI Assistant"
          className="fixed bottom-20 right-6 z-40 w-16 h-16 rounded-full shadow-xl cursor-pointer group"
        >
          <span className="absolute inset-0 rounded-full bg-[#2962FF] opacity-75 animate-ping" />
          <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-white border-2 border-[#2962FF] overflow-hidden group-hover:scale-105 transition-transform">
            {AVATAR_SRC ? (
              <img
                src={AVATAR_SRC}
                alt="Chat with Tejoma AI"
                style={{ objectPosition: AVATAR_POSITION }}
                className="w-full h-full object-cover"
              />
            ) : (
              <Bot className="w-7 h-7 text-[#2962FF]" />
            )}
          </span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-5rem)] bg-white rounded-2xl shadow-2xl border border-[#E0E0E0] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#1A1A1A] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar />
              <div className="min-w-0">
                <p className="text-white text-sm font-bold truncate">Tejoma AI Assistant</p>
                <p className="text-[#A0A0A0] text-[11px] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#27AE60] inline-block" /> Online
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-white cursor-pointer flex-shrink-0" aria-label="Close chat">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#F8F9FA]">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {m.role === 'assistant' && <Avatar size="w-7 h-7" />}
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[#2962FF] text-white rounded-br-sm'
                      : 'bg-white border border-[#E0E0E0] text-[#1A1A1A] rounded-bl-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start gap-2">
                <Avatar size="w-7 h-7" />
                <div className="bg-white border border-[#E0E0E0] rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                  <Loader className="w-3.5 h-3.5 animate-spin text-[#666666]" />
                  <span className="text-xs text-[#666666]">Thinking...</span>
                </div>
              </div>
            )}

            {!loading && lastSources.length > 0 && (
              <p className="text-[10px] text-[#999999] text-center pt-1">
                Based on {lastSources.length} matching record{lastSources.length !== 1 ? 's' : ''} from your candidates/jobs.
              </p>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="flex items-center gap-2 p-3 border-t border-[#E0E0E0] bg-white flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about candidates or jobs..."
              disabled={loading}
              className="flex-1 bg-[#F5F5F5] border border-[#E0E0E0] rounded-full py-2.5 px-4 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] transition-colors disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-10 h-10 rounded-full bg-[#2962FF] hover:bg-[#1E4FD9] disabled:bg-[#CCCCCC] text-white flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
