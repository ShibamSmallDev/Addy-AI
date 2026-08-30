import { useEffect, useRef, useState } from "react";
import {
  X,
  Copy,
  RefreshCw,
  Pencil,
  Send,
  Check,
  MessageSquare,
  Plus,
  Search,
  PanelLeft,
  Mic,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { formatDate, formatDuration } from "../lib/sessionFormat";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
}

interface SessionSummary {
  id: string;
  title: string;
  startTime: number;
  endTime: number | null;
  mode: string;
  messageCount: number;
  summary: string | null;
}

interface TextChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onRegenerate: () => void;
  onEditMessage: (id: string, newText: string) => void;
  onNewSession: () => void;
  isStreaming: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onRefreshSessions: () => void;
}

export function TextChatPanel({
  isOpen,
  onClose,
  messages,
  onSend,
  onRegenerate,
  onEditMessage,
  onNewSession,
  isStreaming,
  sessions,
  activeSessionId,
  onSelectSession,
  onRefreshSessions,
}: TextChatPanelProps) {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRail, setShowRail] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSummary, setShowSummary] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) onRefreshSessions();
  }, [isOpen, onRefreshSessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const filteredSessions = sessions.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      (s.summary || "").toLowerCase().includes(q) ||
      formatDate(s.startTime).toLowerCase().includes(q)
    );
  });

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    onSend(trimmed);
  };

  const handleEditSave = (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    onEditMessage(id, trimmed);
    setEditingId(null);
    setEditText("");
  };

  const startEdit = (msg: ChatMessage) => {
    setEditingId(msg.id);
    setEditText(msg.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="fixed inset-y-0 right-0 w-full sm:w-[760px] z-50 flex bg-slate-950 border-l border-white/10 shadow-2xl"
        >
          {/* Session rail (ChatGPT-style left sidebar) */}
          <div
            className={`${
              showRail ? "flex" : "hidden"
            } sm:flex flex-col w-52 sm:w-64 shrink-0 border-r border-white/10 bg-slate-900/60 h-full overflow-hidden`}
          >
            {/* Rail header */}
            <div className="p-3 border-b border-white/10">
              <div className="flex items-center justify-between px-1 mb-3">
                <span className="text-[11px] font-bold tracking-widest uppercase text-white/60 font-mono">Addy</span>
                <button
                  onClick={() => setShowRail(false)}
                  className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-white transition cursor-pointer sm:hidden"
                >
                  <X size={12} />
                </button>
              </div>
              <button
                onClick={() => { onNewSession(); setSearchQuery(""); }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-[12px] font-medium transition cursor-pointer"
              >
                <Plus size={14} />
                New Chat
              </button>
              <div className="relative mt-2">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/60"
                  placeholder="Search chats..."
                />
              </div>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 scrollbar-thin">
              {filteredSessions.length === 0 && (
                <div className="text-center py-6 text-[10px] text-slate-600">
                  {searchQuery ? "No matching chats" : "No sessions yet"}
                </div>
              )}
              {filteredSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { onSelectSession(s.id); }}
                  className={`w-full text-left p-2.5 rounded-lg transition text-[11px] cursor-pointer ${
                    activeSessionId === s.id
                      ? "bg-cyan-500/10 border border-cyan-500/20"
                      : "hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <div className={`truncate font-medium ${activeSessionId === s.id ? "text-cyan-300" : "text-slate-300"}`}>
                    {s.title}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[9px] text-slate-500 font-mono">
                    {s.mode === "voice" && <Mic size={9} className="text-emerald-400" />}
                    {s.mode === "text" && <MessageSquare size={9} className="text-amber-400" />}
                    <span>{s.messageCount} msgs</span>
                    <span>·</span>
                    <span>{formatDate(s.startTime)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Main panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowRail(!showRail)}
                  className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-cyan-400 transition cursor-pointer"
                  title="Session history"
                >
                  <PanelLeft size={14} />
                </button>
                <div>
                  <h2 className="text-sm font-semibold text-white tracking-wide">
                    {activeSession?.title || "Text Chat"}
                  </h2>
                  <p className="text-[10px] text-white/40 font-mono">
                    {activeSession
                      ? `${activeSession.messageCount} messages · ${formatDuration(activeSession.startTime, activeSession.endTime)}`
                      : `${messages.length} messages`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { if (confirm("Clear all messages and start a new session?")) onNewSession(); }}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/30 hover:text-cyan-400 text-[10px] font-mono cursor-pointer"
                  title="New Session"
                >
                  + NEW
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Active session summary chip */}
            {activeSession?.summary && showSummary && (
              <div className="px-4 pt-3">
                <div className="rounded-xl border border-violet-500/10 bg-violet-500/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-violet-300 uppercase tracking-widest">Where you left off</span>
                    <button
                      onClick={() => setShowSummary(false)}
                      className="text-slate-500 hover:text-white transition cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-3 leading-relaxed">{activeSession.summary}</p>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-white/20">
                  <Send size={32} className="mb-3 opacity-30" />
                  <p className="text-sm font-mono">New conversation</p>
                  <p className="text-[10px] mt-1">Type below or pick a chat on the left</p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {editingId === msg.id ? (
                    /* Inline edit mode */
                    <div className="w-full max-w-[85%]">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full bg-slate-800 border border-cyan-500/30 rounded-xl p-3 text-sm text-white font-mono resize-none focus:outline-none focus:border-cyan-400/50 min-h-[80px]"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1.5 text-[11px] font-mono text-white/50 hover:text-white transition-colors rounded-md hover:bg-white/5 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleEditSave(msg.id)}
                          className="px-3 py-1.5 text-[11px] font-mono text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Check size={12} />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Message bubble */
                    <div className={`max-w-[85%] group ${msg.role === "user" ? "order-1" : "order-0"}`}>
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-cyan-500/15 text-cyan-100 border border-cyan-500/10"
                            : "bg-slate-800/80 text-slate-200 border border-white/5"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      </div>

                      {/* Action buttons */}
                      <div className={`flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <button
                          onClick={() => handleCopy(msg.text, msg.id)}
                          className="p-1 rounded-md hover:bg-white/5 transition-colors text-white/30 hover:text-white/70 cursor-pointer"
                          title="Copy"
                        >
                          {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>

                        {msg.role === "user" && (
                          <button
                            onClick={() => startEdit(msg)}
                            className="p-1 rounded-md hover:bg-white/5 transition-colors text-white/30 hover:text-white/70 cursor-pointer"
                            title="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                        )}

                        {msg.role === "model" && (
                          <button
                            onClick={onRegenerate}
                            disabled={isStreaming}
                            className="p-1 rounded-md hover:bg-white/5 transition-colors text-white/30 hover:text-white/70 disabled:opacity-30 cursor-pointer"
                            title="Regenerate"
                          >
                            <RefreshCw size={12} className={isStreaming ? "animate-spin" : ""} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isStreaming && (
                <div className="flex justify-start">
                  <div className="bg-slate-800/80 border border-white/5 rounded-2xl px-4 py-3">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-cyan-400/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-cyan-400/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="border-t border-white/10 p-4 shrink-0">
              <div className="flex items-center gap-2 bg-slate-900 rounded-xl border border-white/10 focus-within:border-cyan-500/30 transition-colors px-4 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isStreaming ? "Addy is typing..." : "Type a message..."}
                  disabled={isStreaming}
                  className="flex-1 bg-transparent text-sm text-white placeholder-white/30 font-mono focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Send size={14} />
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}