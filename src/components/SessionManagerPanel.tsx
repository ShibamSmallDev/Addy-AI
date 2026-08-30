import { useState, useEffect, useCallback } from 'react';
import { Search, Clock, MessageSquare, Monitor, X, Trash2, RotateCcw } from 'lucide-react';
import { formatDate, formatDuration } from '../lib/sessionFormat';

interface SessionSummary {
  id: string;
  title: string;
  startTime: number;
  endTime: number | null;
  workspace: string | null;
  activeProject: string | null;
  mode: 'voice' | 'text' | 'mixed';
  messageCount: number;
  toolCallCount: number;
  summary: string | null;
}

interface RecallData {
  session: {
    lastSessionSummary: string | null;
    lastSessionId: string | null;
    lastSessionTime: number | null;
  };
  longTerm: {
    preferences: Record<string, string>;
    projects: string[];
    decisions: string[];
    frequentlyReferenced: string[];
  };
  activeProject: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  themeColor?: string;
  onResumeSession?: (sessionId: string) => void;
}

export function SessionManagerPanel({ isOpen, onClose, themeColor, onResumeSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recall, setRecall] = useState<RecallData | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sessionMessages, setSessionMessages] = useState<{ role: string; text: string; timestamp: number }[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  const fetchSessions = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const url = q ? `/api/phasex/search?q=${encodeURIComponent(q)}` : '/api/phasex/sessions';
      const res = await fetch(url);
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch { setSessions([]); }
    setLoading(false);
  }, []);

  const fetchRecall = useCallback(async () => {
    try {
      const res = await fetch('/api/phasex/recall');
      if (res.ok) setRecall(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
      fetchRecall();
    }
  }, [isOpen, fetchSessions, fetchRecall]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSessions(searchQuery);
  };

  const handleSelectSession = async (s: SessionSummary) => {
    setSelectedSession(s);
    setMsgLoading(true);
    try {
      const res = await fetch(`/api/phasex/sessions/${s.id}`);
      const data = await res.json();
      setSessionMessages(data.messages || []);
    } catch { setSessionMessages([]); }
    setMsgLoading(false);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await fetch(`/api/phasex/sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedSession?.id === id) setSelectedSession(null);
    } catch {}
  };

  return (
    <div
      className={`fixed top-0 right-0 h-full w-96 max-w-[90vw] z-50 transition-transform duration-300 ease-out bg-[#0a0a0f]/95 backdrop-blur-2xl border-l border-white/10 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-cyan-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-white font-mono">Sessions</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition cursor-pointer">
            <X size={14} />
          </button>
        </div>

        {/* Recall bar */}
        {recall?.session?.lastSessionSummary && (
          <div className="mx-4 mt-3 p-3 rounded-xl border border-violet-500/10 bg-violet-500/5">
            <div className="text-[9px] font-mono text-violet-300 mb-1">LAST SESSION</div>
            <p className="text-[10px] text-slate-300 line-clamp-2 leading-relaxed">{recall.session.lastSessionSummary}</p>
            {recall.activeProject && (
              <div className="mt-1.5 text-[9px] text-cyan-400 font-mono">{recall.activeProject}</div>
            )}
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} className="px-4 py-2.5 flex gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/60"
              placeholder="Search sessions..."
            />
          </div>
        </form>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
          {loading && <div className="text-center py-8 text-[10px] text-slate-500">Loading...</div>}

          {!loading && sessions.length === 0 && (
            <div className="text-center py-8 text-[10px] text-slate-500">No sessions yet</div>
          )}

          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => handleSelectSession(s)}
              className={`p-3 rounded-xl border cursor-pointer transition group ${
                selectedSession?.id === s.id
                  ? 'border-cyan-500/30 bg-cyan-500/5'
                  : 'border-white/5 hover:border-white/10 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[11px] font-medium text-white truncate">{s.title}</h3>
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-500 font-mono">
                    <span>{formatDate(s.startTime)}</span>
                    <span>·</span>
                    <span>{formatDuration(s.startTime, s.endTime)}</span>
                    <span>·</span>
                    <span className={s.mode === 'voice' ? 'text-emerald-400' : s.mode === 'text' ? 'text-amber-400' : 'text-cyan-400'}>
                      {s.mode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-600 font-mono">
                    <span>{s.messageCount} msgs</span>
                    {s.toolCallCount > 0 && <span>· {s.toolCallCount} tools</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {s.summary && (
                <p className="mt-1.5 text-[10px] text-slate-500 line-clamp-1 leading-relaxed">{s.summary}</p>
              )}
            </div>
          ))}
        </div>

        {/* Session detail panel (slide-up from bottom) */}
        {selectedSession && (
          <div className="border-t border-white/10 bg-black/60 max-h-[50vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2">
              <h3 className="text-[10px] font-mono text-cyan-300 truncate max-w-[200px]">{selectedSession.title}</h3>
              <div className="flex items-center gap-1.5">
                {onResumeSession && selectedSession.mode !== 'voice' && (
                  <button
                    onClick={() => {
                      onResumeSession(selectedSession.id);
                      setSelectedSession(null);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-[9px] font-mono transition cursor-pointer"
                    title="Resume this session in Text Chat"
                  >
                    <RotateCcw size={10} />
                    <span>Resume</span>
                  </button>
                )}
                <button onClick={() => setSelectedSession(null)} className="p-1 hover:bg-white/5 rounded cursor-pointer">
                  <X size={12} className="text-slate-500" />
                </button>
              </div>
            </div>

            {msgLoading ? (
              <div className="text-center py-4 text-[9px] text-slate-500">Loading messages...</div>
            ) : (
              <div className="px-4 pb-4 space-y-2">
                {sessionMessages.length === 0 && (
                  <div className="text-center py-3 text-[9px] text-slate-500">No messages</div>
                )}
                {sessionMessages.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <span className={`shrink-0 text-[9px] font-mono w-8 ${m.role === 'Addy' ? 'text-cyan-400' : 'text-amber-400'}`}>
                      {m.role === 'Addy' ? 'Addy' : 'YOU'}
                    </span>
                    <p className="text-[10px] text-slate-300 leading-relaxed">{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
