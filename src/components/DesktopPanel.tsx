import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Compass, 
  X, 
  Sparkles, 
  Sliders, 
  Terminal, 
  Scan, 
  Clock, 
  MousePointer, 
  Camera, 
  Send,
  CornerDownLeft,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { desktopDispatcher, getActionSeverity, type DesktopAction } from '../lib/desktop/DesktopDispatcher';

type Tab = 'control' | 'plan' | 'screen' | 'history';

interface ActionButton {
  label: string;
  action: DesktopAction;
  args?: Record<string, unknown>;
  color?: string;
  icon?: any;
}

const QUICK_ACTIONS: ActionButton[] = [
  { label: 'Click', action: 'mouseClick', color: 'cyan', icon: MousePointer },
  { label: 'Right Click', action: 'mouseRightClick', color: 'cyan', icon: MousePointer },
  { label: 'Double Click', action: 'mouseDoubleClick', color: 'cyan', icon: MousePointer },
  { label: 'Scroll Up', action: 'mouseScroll', args: { clicks: 3 }, color: 'slate', icon: ChevronUp },
  { label: 'Scroll Down', action: 'mouseScroll', args: { clicks: -3 }, color: 'slate', icon: ChevronDown },
  { label: 'Enter', action: 'pressKey', args: { key: 'enter' }, color: 'amber', icon: CornerDownLeft },
  { label: 'Tab', action: 'pressKey', args: { key: 'tab' }, color: 'amber' },
  { label: 'Escape', action: 'pressKey', args: { key: 'escape' }, color: 'amber' },
  { label: 'Screenshot', action: 'takeScreenshot', color: 'emerald', icon: Camera },
  { label: 'Read Screen', action: 'readScreen', color: 'emerald', icon: Scan },
];

export interface DesktopPanelProps {
  isOpen: boolean;
  onClose: () => void;
  themeColor?: string;
}

export function DesktopPanel({ isOpen, onClose, themeColor = 'charcoal' }: DesktopPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('control');
  const [status, setStatus] = useState<string>('');
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [permissionPending, setPermissionPending] = useState<{
    action: DesktopAction;
    args: Record<string, unknown>;
    resolve: (allow: boolean) => void;
  } | null>(null);
  const [history, setHistory] = useState<{ action: DesktopAction; args: Record<string, unknown>; result: string }[]>([]);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenAnalysis, setScreenAnalysis] = useState<string>('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [planResult, setPlanResult] = useState<{ action: string; target: string; args: Record<string, unknown>; confidence: number; resolved: boolean } | null>(null);

  const coordTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    desktopDispatcher.setPermissionHandler((action, args, resolve) => {
      setPermissionPending({ action, args, resolve });
    });
    return () => {
      desktopDispatcher.setPermissionHandler(() => {});
    };
  }, []);

  // Poll coordinates only when drawer is open and control tab is active
  useEffect(() => {
    if (!isOpen || activeTab !== 'control') {
      if (coordTimer.current) clearInterval(coordTimer.current);
      return;
    }
    const fetchPos = async () => {
      const r = await desktopDispatcher.execute('mouseGetPosition');
      if (r.ok && r.result && typeof r.result === 'object' && 'x' in r.result && 'y' in r.result) {
        const pos = r.result as { x: number; y: number };
        setMouseX(pos.x);
        setMouseY(pos.y);
      }
    };
    fetchPos();
    coordTimer.current = setInterval(fetchPos, 1000);
    return () => {
      if (coordTimer.current) clearInterval(coordTimer.current);
    };
  }, [isOpen, activeTab]);

  const doAction = useCallback(async (action: DesktopAction, args: Record<string, unknown> = {}) => {
    setStatus(`Executing ${action}...`);
    const r = await desktopDispatcher.execute(action, args);
    setStatus(r.ok ? `${action} done` : `Error: ${r.error || 'unknown'}`);
    setHistory((prev) => [{ action, args, result: r.ok ? 'ok' : `FAIL: ${r.error}` }, ...prev].slice(0, 50));
  }, []);

  const doScreenshot = useCallback(async () => {
    setStatus('Capturing screen...');
    const r = await desktopDispatcher.execute('takeScreenshot');
    if (r.ok && r.result && typeof r.result === 'object' && 'result' in r.result) {
      const data = r.result as { result: string; image?: string };
      setScreenshotUrl(data.image ? `data:image/png;base64,${data.image}` : null);
      setStatus('Screenshot captured');
    } else {
      setStatus(`Screenshot failed: ${r.error || 'unknown'}`);
    }
  }, []);

  const doAnalyzeScreen = useCallback(async () => {
    setAnalysisLoading(true);
    setScreenAnalysis('');
    setStatus('Analyzing screen with OCR/Vision...');
    const r = await desktopDispatcher.execute('analyzeScreenshot');
    if (r.ok) {
      const text = typeof r.result === 'object' ? JSON.stringify(r.result, null, 2) : String(r.result || '');
      setScreenAnalysis(text.slice(0, 3000));
      setStatus('Screen analysis complete');
    } else {
      setScreenAnalysis(`Error: ${r.error}`);
      setStatus(`Analysis error: ${r.error}`);
    }
    setAnalysisLoading(false);
  }, []);

  const handlePermissionResponse = (allow: boolean) => {
    if (permissionPending) {
      permissionPending.resolve(allow);
      setPermissionPending(null);
    }
  };

  const handleCoordinateClick = () => {
    doAction('mouseClick', { x: mouseX, y: mouseY });
  };

  const getThemeBadgeGlow = () => {
    switch (themeColor) {
      case "violet": return "border-purple-500/30 text-purple-400 bg-purple-500/10";
      case "crimson": return "border-rose-500/30 text-rose-400 bg-rose-500/10";
      case "emerald": return "border-emerald-500/30 text-emerald-400 bg-emerald-500/10";
      case "celestial": return "border-sky-500/30 text-sky-400 bg-sky-500/10";
      case "gold": return "border-amber-500/30 text-amber-400 bg-amber-500/10";
      case "rose": return "border-pink-500/30 text-pink-400 bg-pink-500/10";
      default:
        return "border-indigo-500/30 text-indigo-400 bg-indigo-500/10";
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed inset-y-0 right-0 w-full max-w-lg bg-[#020206]/95 border-l border-white/15 backdrop-blur-2xl z-50 flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.8)] font-mono text-xs text-slate-200"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${getThemeBadgeGlow()}`}>
                <Compass size={22} className="animate-pulse" />
              </div>
              <div>
                <h3 className="font-display font-medium text-lg tracking-tight text-white flex items-center gap-2">
                  OS Radar &amp; Controls
                  <Sparkles size={14} className="text-cyan-400" />
                </h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mt-0.5">
                  52 Tools Online • Desktop Automation
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
              title="Close Panel"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-white/10 px-4 shrink-0 bg-white/[0.02]">
            {(
              [
                { id: 'control', label: 'Control', icon: Sliders },
                { id: 'plan', label: 'Planner', icon: Terminal },
                { id: 'screen', label: 'Vision', icon: Scan },
                { id: 'history', label: 'History', icon: Clock },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-1 py-3 px-2 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider cursor-pointer transition ${
                    activeTab === t.id
                      ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-400/5 font-semibold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon size={12} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Live Status Bar */}
          <div className="px-5 py-2 text-[10px] text-slate-400 border-b border-white/5 flex items-center gap-3 bg-black/30 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="truncate max-w-[240px]">{status || 'Agent Ready'}</span>
            <span className="ml-auto font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
              X:{mouseX} Y:{mouseY}
            </span>
          </div>

          {/* Permission Dialog */}
          {permissionPending && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-[#14141f] border border-white/15 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                <div className="text-center space-y-3">
                  <div className="text-2xl">
                    {getActionSeverity(permissionPending.action) === 'destructive' ? '⚠️' : '🖱️'}
                  </div>
                  <h3 className="text-sm font-semibold text-white">Desktop Action</h3>
                  <p className="text-[11px] text-slate-400">
                    Allow <span className={
                      getActionSeverity(permissionPending.action) === 'destructive'
                        ? 'text-rose-300 font-bold'
                        : getActionSeverity(permissionPending.action) === 'harmless'
                        ? 'text-emerald-300 font-bold'
                        : 'text-cyan-300 font-bold'
                    }>{permissionPending.action}</span>?
                  </p>
                  <div className="flex justify-center gap-2">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${
                      getActionSeverity(permissionPending.action) === 'destructive'
                        ? 'border-rose-500/30 text-rose-300 bg-rose-500/10'
                        : getActionSeverity(permissionPending.action) === 'harmless'
                        ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                        : 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                    }`}>
                      {getActionSeverity(permissionPending.action)}
                    </span>
                  </div>
                  {Object.keys(permissionPending.args).length > 0 && (
                    <pre className="text-[9px] text-slate-500 bg-black/40 p-2 rounded-lg text-left max-h-24 overflow-auto">
                      {JSON.stringify(permissionPending.args, null, 2)}
                    </pre>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => handlePermissionResponse(false)}
                      className="flex-1 py-2 rounded-xl border border-rose-500/30 text-rose-300 text-[10px] font-mono hover:bg-rose-500/10 transition cursor-pointer"
                    >
                      Deny
                    </button>
                    <button
                      onClick={() => handlePermissionResponse(true)}
                      className="flex-1 py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono hover:bg-cyan-500/30 transition cursor-pointer"
                    >
                      Allow
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeTab === 'control' && (
              <>
                {/* Target Coordinates */}
                <div className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">
                    Target Coordinates
                  </span>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 focus-within:border-cyan-500/60">
                      <span className="text-slate-500 text-[10px]">X:</span>
                      <input
                        type="number"
                        value={mouseX}
                        onChange={(e) => setMouseX(Number(e.target.value))}
                        className="w-full bg-transparent text-[11px] text-white focus:outline-none"
                      />
                    </div>
                    <div className="flex-1 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 focus-within:border-cyan-500/60">
                      <span className="text-slate-500 text-[10px]">Y:</span>
                      <input
                        type="number"
                        value={mouseY}
                        onChange={(e) => setMouseY(Number(e.target.value))}
                        className="w-full bg-transparent text-[11px] text-white focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={handleCoordinateClick}
                      className="px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-400/40 text-cyan-200 text-[10px] font-bold hover:bg-cyan-500/25 transition cursor-pointer shrink-0 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                    >
                      Click Here
                    </button>
                  </div>
                </div>

                {/* Quick Actions Grid */}
                <div className="space-y-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">
                    Quick Automation Actions
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {QUICK_ACTIONS.map((btn) => {
                      const Icon = btn.icon;
                      return (
                        <button
                          key={btn.label}
                          onClick={() => doAction(btn.action, btn.args)}
                          className={`p-2.5 rounded-xl border text-[11px] font-mono flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            btn.color === 'cyan'
                              ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 shadow-[0_0_10px_rgba(34,211,238,0.08)]'
                              : btn.color === 'amber'
                              ? 'border-amber-500/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                              : btn.color === 'emerald'
                              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                              : 'border-slate-500/25 bg-slate-500/10 text-slate-200 hover:bg-slate-500/20'
                          }`}
                        >
                          {Icon && <Icon size={13} className="shrink-0 opacity-70" />}
                          <span className="truncate">{btn.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Type Text */}
                <div className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">
                    Type Text into Active Field
                  </span>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = (e.target as HTMLFormElement).querySelector('input')!;
                      if (input.value) {
                        doAction('typeText', { text: input.value });
                        input.value = '';
                      }
                    }}
                    className="flex gap-2"
                  >
                    <input
                      className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white focus:outline-none focus:border-cyan-500/60"
                      placeholder="Type text to send..."
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold hover:bg-cyan-500/25 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Send size={11} />
                      <span>Type</span>
                    </button>
                  </form>
                </div>

                {/* Key Combination */}
                <div className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">
                    Key Combination &amp; Hotkeys
                  </span>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.target as HTMLFormElement;
                      const combo = (f.querySelector('input') as HTMLInputElement).value.trim();
                      if (combo) {
                        const parts = combo.split('+').map((s) => s.trim());
                        if (parts.length === 2) {
                          doAction('pressKeyCombination', { modifiers: [parts[0].toLowerCase()], key: parts[1].toLowerCase() });
                        } else {
                          doAction('pressKey', { key: combo });
                        }
                      }
                    }}
                    className="flex gap-2"
                  >
                    <input
                      className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white focus:outline-none focus:border-amber-500/60"
                      placeholder="e.g. ctrl+c, alt+tab, or enter"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[10px] font-bold hover:bg-amber-500/25 transition cursor-pointer"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </>
            )}

            {activeTab === 'plan' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
                  <label className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">
                    Natural Language Desktop Intent
                  </label>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const input = (e.target as HTMLFormElement).querySelector('input')!;
                      const desc = input.value.trim();
                      if (!desc) return;
                      setStatus(`Planning: "${desc.slice(0, 40)}..."`);
                      try {
                        const res = await fetch('/api/desktop/plan', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ description: desc }),
                        });
                        const data = await res.json();
                        if (data.ok && data.plan) {
                          setPlanResult(data.plan);
                          setStatus(`Planned: ${data.plan.action}`);
                        } else {
                          setStatus(`Plan failed: ${data.error || 'unknown'}`);
                        }
                      } catch (err: any) {
                        setStatus(`Plan error: ${err.message}`);
                      }
                      input.value = '';
                    }}
                    className="flex gap-2"
                  >
                    <input
                      className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-[11px] text-white focus:outline-none focus:border-cyan-500/60"
                      placeholder='e.g. "click the Chrome icon" or "scroll down"'
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold hover:bg-cyan-500/25 transition cursor-pointer"
                    >
                      Plan
                    </button>
                  </form>
                </div>

                {planResult && (
                  <div className="space-y-2.5 p-4 rounded-xl border border-white/10 bg-black/40">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Action:</span>
                      <span className="text-cyan-300 font-bold">{planResult.action}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Target:</span>
                      <span className="text-slate-200">{planResult.target}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Confidence:</span>
                      <span className={`${planResult.confidence >= 80 ? 'text-emerald-300' : planResult.confidence >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>
                        {planResult.confidence}% {planResult.resolved && '(coordinates resolved)'}
                      </span>
                    </div>
                    {Object.keys(planResult.args).length > 0 && (
                      <pre className="text-[9px] text-slate-400 bg-black/60 p-2.5 rounded-lg overflow-auto max-h-24">
                        {JSON.stringify(planResult.args, null, 2)}
                      </pre>
                    )}
                    <button
                      onClick={() => {
                        doAction(planResult.action as any, planResult.args);
                      }}
                      className="w-full py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25 transition cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                    >
                      Execute Planned Action
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'screen' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={doScreenshot}
                    className="flex-1 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs font-bold hover:bg-emerald-500/20 transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Camera size={14} />
                    <span>Capture Screen</span>
                  </button>
                  <button
                    onClick={doAnalyzeScreen}
                    disabled={analysisLoading}
                    className="flex-1 py-2.5 rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-200 text-xs font-bold hover:bg-violet-500/20 transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Scan size={14} />
                    <span>{analysisLoading ? 'Analyzing...' : 'OCR / Analyze'}</span>
                  </button>
                </div>

                {screenshotUrl && (
                  <div className="border border-white/10 rounded-xl overflow-hidden shadow-lg">
                    <img src={screenshotUrl} alt="Screenshot" className="w-full" />
                  </div>
                )}

                {screenAnalysis && (
                  <div className="p-3.5 rounded-xl border border-white/10 bg-black/40">
                    <pre className="text-[10px] text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
                      {screenAnalysis}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-1.5">
                {history.length === 0 && (
                  <div className="text-center py-12 text-slate-500 text-[11px]">
                    No desktop actions recorded in this session.
                  </div>
                )}
                {history.map((entry, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-xl border text-[10px] font-mono flex items-center justify-between gap-2 ${
                      entry.result === 'ok'
                        ? 'border-emerald-500/15 bg-emerald-500/5'
                        : 'border-rose-500/15 bg-rose-500/5'
                    }`}
                  >
                    <span className={entry.result === 'ok' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {entry.action}
                    </span>
                    <span className="text-slate-400 truncate max-w-[180px]">
                      {JSON.stringify(entry.args)}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      entry.result === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                    }`}>
                      {entry.result}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
