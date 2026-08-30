import { useState, useEffect, useCallback, useRef } from 'react';
import { desktopDispatcher, getActionSeverity, type DesktopAction } from '../lib/desktop/DesktopDispatcher';

type Tab = 'control' | 'plan' | 'screen' | 'history';

interface ActionButton {
  label: string;
  action: DesktopAction;
  args?: Record<string, unknown>;
  color?: string;
}

const QUICK_ACTIONS: ActionButton[] = [
  { label: 'Click', action: 'mouseClick', color: 'cyan' },
  { label: 'R-Click', action: 'mouseRightClick', color: 'cyan' },
  { label: 'D-Click', action: 'mouseDoubleClick', color: 'cyan' },
  { label: 'Scroll ↑', action: 'mouseScroll', args: { clicks: 3 }, color: 'slate' },
  { label: 'Scroll ↓', action: 'mouseScroll', args: { clicks: -3 }, color: 'slate' },
  { label: 'Enter', action: 'pressKey', args: { key: 'enter' }, color: 'amber' },
  { label: 'Tab', action: 'pressKey', args: { key: 'tab' }, color: 'amber' },
  { label: 'Esc', action: 'pressKey', args: { key: 'escape' }, color: 'amber' },
  { label: 'Screenshot', action: 'takeScreenshot', color: 'emerald' },
  { label: 'Read Screen', action: 'readScreen', color: 'emerald' },
];

export function DesktopPanel() {
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

  useEffect(() => {
    coordTimer.current = setInterval(async () => {
      const r = await desktopDispatcher.execute('mouseGetPosition');
      if (r.ok && r.result && typeof r.result === 'object' && 'x' in r.result && 'y' in r.result) {
        const pos = r.result as { x: number; y: number };
        setMouseX(pos.x);
        setMouseY(pos.y);
      }
    }, 1000);
    return () => clearInterval(coordTimer.current);
  }, []);

  const doAction = useCallback(async (action: DesktopAction, args: Record<string, unknown> = {}) => {
    setStatus(`Executing ${action}...`);
    const r = await desktopDispatcher.execute(action, args);
    setStatus(r.ok ? `${action} done` : `Error: ${r.error || 'unknown'}`);
    setHistory((prev) => [{ action, args, result: r.ok ? 'ok' : `FAIL: ${r.error}` }, ...prev].slice(0, 50));
  }, []);

  const doScreenshot = useCallback(async () => {
    const r = await desktopDispatcher.execute('takeScreenshot');
    if (r.ok && r.result && typeof r.result === 'object' && 'result' in r.result) {
      const data = r.result as { result: string; image?: string };
      setScreenshotUrl(data.image ? `data:image/png;base64,${data.image}` : null);
    }
  }, []);

  const doAnalyzeScreen = useCallback(async () => {
    setAnalysisLoading(true);
    setScreenAnalysis('');
    const r = await desktopDispatcher.execute('analyzeScreenshot');
    if (r.ok) {
      const text = typeof r.result === 'object' ? JSON.stringify(r.result) : String(r.result || '');
      setScreenAnalysis(text.slice(0, 3000));
    } else {
      setScreenAnalysis(`Error: ${r.error}`);
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

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-slate-200 font-mono text-xs">
      {/* Tabs */}
      <div className="flex border-b border-white/10">
          {(['control', 'plan', 'screen', 'history'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[10px] uppercase tracking-wider cursor-pointer transition ${
              activeTab === tab
                ? 'text-cyan-300 border-b-2 border-cyan-400 bg-cyan-400/5'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Permission dialog */}
      {permissionPending && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#14141f] border border-white/15 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
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

      {/* Status bar */}
      <div className="px-3 py-1.5 text-[9px] text-slate-500 border-b border-white/5 flex items-center gap-3">
        <span className="text-emerald-400">●</span>
        <span>{status || 'Ready'}</span>
        <span className="ml-auto">X:{mouseX} Y:{mouseY}</span>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'control' && (
          <>
            {/* Coordinate input */}
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={mouseX}
                onChange={(e) => setMouseX(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded-lg border border-white/10 bg-black/40 text-[10px] text-white"
                placeholder="X"
              />
              <input
                type="number"
                value={mouseY}
                onChange={(e) => setMouseY(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded-lg border border-white/10 bg-black/40 text-[10px] text-white"
                placeholder="Y"
              />
              <button
                onClick={handleCoordinateClick}
                className="px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[9px] hover:bg-cyan-500/20 transition cursor-pointer"
              >
                Go
              </button>
            </div>

            {/* Quick actions grid */}
            <div className="grid grid-cols-5 gap-1.5">
              {QUICK_ACTIONS.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => doAction(btn.action, btn.args)}
                  className={`px-2 py-2 rounded-lg border text-[9px] font-mono transition cursor-pointer ${
                    btn.color === 'cyan'
                      ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/15'
                      : btn.color === 'amber'
                      ? 'border-amber-500/20 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15'
                      : btn.color === 'emerald'
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15'
                      : 'border-slate-500/20 bg-slate-500/5 text-slate-300 hover:bg-slate-500/15'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Text input */}
            <div className="space-y-1">
              <label className="text-[9px] text-slate-500 uppercase tracking-wider">Type text</label>
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
                  className="flex-1 px-2 py-1.5 rounded-lg border border-white/10 bg-black/40 text-[10px] text-white focus:outline-none focus:border-cyan-500/60"
                  placeholder="Type something..."
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[9px] hover:bg-cyan-500/20 transition cursor-pointer"
                >
                  Type
                </button>
              </form>
            </div>

            {/* Key combination */}
            <div className="space-y-1">
              <label className="text-[9px] text-slate-500 uppercase tracking-wider">Key combo</label>
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
                  className="flex-1 px-2 py-1.5 rounded-lg border border-white/10 bg-black/40 text-[10px] text-white focus:outline-none focus:border-cyan-500/60"
                  placeholder="e.g. ctrl+c or enter"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px] hover:bg-amber-500/20 transition cursor-pointer"
                >
                  Send
                </button>
              </form>
            </div>
          </>
        )}

        {activeTab === 'plan' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[9px] text-slate-500 uppercase tracking-wider">
                What would you like to do?
              </label>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const input = (e.target as HTMLFormElement).querySelector('input')!;
                  const desc = input.value.trim();
                  if (!desc) return;
                  setStatus(`Planning: "${desc.slice(0, 50)}..."`);
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
                  className="flex-1 px-2 py-1.5 rounded-lg border border-white/10 bg-black/40 text-[10px] text-white focus:outline-none focus:border-cyan-500/60"
                  placeholder='e.g. "click the Downloads button" or "scroll down"'
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[9px] hover:bg-cyan-500/20 transition cursor-pointer"
                >
                  Plan
                </button>
              </form>
            </div>

            {planResult && (
              <div className="space-y-2 p-3 rounded-xl border border-white/10 bg-black/40">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-slate-400">Action:</span>
                  <span className="text-cyan-300 font-bold">{planResult.action}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-slate-400">Target:</span>
                  <span className="text-slate-200">{planResult.target}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-slate-400">Confidence:</span>
                  <span className={`${planResult.confidence >= 80 ? 'text-emerald-300' : planResult.confidence >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {planResult.confidence}%
                  </span>
                  {planResult.resolved && (
                    <span className="text-emerald-400/60 text-[8px]">(coordinates resolved)</span>
                  )}
                </div>
                {Object.keys(planResult.args).length > 0 && (
                  <pre className="text-[8px] text-slate-500 bg-black/60 p-2 rounded-lg overflow-auto max-h-20">
                    {JSON.stringify(planResult.args, null, 2)}
                  </pre>
                )}
                <button
                  onClick={() => {
                    doAction(planResult.action as any, planResult.args);
                  }}
                  className="w-full py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] hover:bg-emerald-500/20 transition cursor-pointer"
                >
                  Execute Plan
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'screen' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={doScreenshot}
                className="flex-1 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-300 text-[10px] hover:bg-emerald-500/15 transition cursor-pointer"
              >
                Capture Screen
              </button>
              <button
                onClick={doAnalyzeScreen}
                disabled={analysisLoading}
                className="flex-1 py-2 rounded-xl border border-violet-500/20 bg-violet-500/5 text-violet-300 text-[10px] hover:bg-violet-500/15 transition disabled:opacity-50 cursor-pointer"
              >
                {analysisLoading ? 'Analyzing...' : 'Analyze Screen'}
              </button>
            </div>

            {screenshotUrl && (
              <div className="border border-white/10 rounded-xl overflow-hidden">
                <img src={screenshotUrl} alt="Screenshot" className="w-full" />
              </div>
            )}

            {screenAnalysis && (
              <div className="p-3 rounded-xl border border-white/10 bg-black/40">
                <pre className="text-[10px] text-slate-300 whitespace-pre-wrap leading-relaxed">{screenAnalysis}</pre>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-1">
            {history.length === 0 && (
              <div className="text-center py-8 text-[10px] text-slate-500">No actions yet</div>
            )}
            {history.map((entry, i) => (
              <div
                key={i}
                className={`p-2 rounded-lg border text-[9px] font-mono ${
                  entry.result === 'ok'
                    ? 'border-emerald-500/10 bg-emerald-500/5'
                    : 'border-rose-500/10 bg-rose-500/5'
                }`}
              >
                <span className={entry.result === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>
                  {entry.action}
                </span>
                <span className="text-slate-500 ml-2">
                  {JSON.stringify(entry.args).slice(0, 80)}
                </span>
                <span className={`ml-2 ${entry.result === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {entry.result}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
