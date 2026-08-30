import { useEffect, useRef, useState, useCallback, type FC, type ReactNode } from "react";
import { AvatarEngine, AnimationState, BlendPriority } from "../avatar";
import type { ActiveTransition } from "../avatar";
import { AvatarCanvas } from "../components/AvatarCanvas";

const FPS_HISTORY_MAX = 60;
const EVENT_LOG_MAX = 200;

type LabSection = "avatar-info" | "statemachine" | "motion" | "expression" | "params" | "physics" | "debug";

const SECTIONS: { id: LabSection; label: string }[] = [
  { id: "avatar-info", label: "AVATAR INFORMATION" },
  { id: "statemachine", label: "STATE MACHINE" },
  { id: "motion", label: "MOTION CONTROLS" },
  { id: "expression", label: "EXPRESSION CONTROLS" },
  { id: "params", label: "LIVE PARAMETERS" },
  { id: "physics", label: "PHYSICS CONTROLS" },
  { id: "debug", label: "DEBUG" },
];

const LAB_PARAMS = [
  { key: "ParamEyeLOpen", label: "Eye Open", min: 0, max: 1.2, step: 0.01 },
  { key: "ParamMouthOpenY", label: "Mouth Open", min: 0, max: 1, step: 0.01 },
  { key: "ParamAngleX", label: "Head Rotation X", min: -30, max: 30, step: 0.5 },
  { key: "ParamAngleY", label: "Head Rotation Y", min: -30, max: 30, step: 0.5 },
  { key: "ParamAngleZ", label: "Head Rotation Z", min: -30, max: 30, step: 0.5 },
  { key: "ParamBodyAngleY", label: "Body Rotation", min: -10, max: 10, step: 0.5 },
  { key: "ParamCoreGlow", label: "Core Glow", min: 0, max: 1.5, step: 0.01 },
  { key: "ParamBlush", label: "Blush", min: 0, max: 1, step: 0.01 },
  { key: "ParamGlitch", label: "Glitch", min: 0, max: 1, step: 0.01 },
];

const PHYSICS_PARAMS = [
  { key: "hair", label: "Hair", min: 0, max: 1, step: 0.05 },
  { key: "ribbon", label: "Ribbon", min: 0, max: 1, step: 0.05 },
  { key: "apron", label: "Apron", min: 0, max: 1, step: 0.05 },
  { key: "skirt", label: "Skirt", min: 0, max: 1, step: 0.05 },
  { key: "sleeves", label: "Sleeves", min: 0, max: 1, step: 0.05 },
  { key: "gravity", label: "Gravity", min: 0, max: 2, step: 0.05 },
  { key: "mass", label: "Mass", min: 0, max: 2, step: 0.05 },
  { key: "damping", label: "Damping", min: 0, max: 1, step: 0.05 },
  { key: "reactionSpeed", label: "Reaction Speed", min: 0, max: 2, step: 0.05 },
];

export default function AvatarLab() {
  const engineRef = useRef<AvatarEngine | null>(null);
  const [fps, setFps] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [rendererType, setRendererType] = useState("pixi");
  const [modelStatus, setModelStatus] = useState("PixiJS Fallback (Active)");
  const [currentState, setCurrentState] = useState("IDLE");
  const [currentMotion, setCurrentMotion] = useState("IDLE");
  const [currentExpression, setCurrentExpression] = useState("Neutral");
  const [currentEmotion, setCurrentEmotion] = useState("idle");
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [physicsValues, setPhysicsValues] = useState<Record<string, number>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.map(s => s.id)));
  const [activeLayers, setActiveLayers] = useState<{ priority: string; state: string; elapsed: number }[]>([]);
  const [activeTransitions, setActiveTransitions] = useState<{ priority: string; from: string | null; to: string; progress: number }[]>([]);
  const [queueStatus, setQueueStatus] = useState<{ priority: string; length: number }[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const fpsFrames = useRef<number[]>([]);
  const lastFpsTime = useRef(performance.now());

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [eventLog]);

  useEffect(() => {
    const engine = new AvatarEngine();
    engine.start(AnimationState.Idle);
    engineRef.current = engine;

    const refreshSM = () => {
      const sm = engine.stateMachine;
      const layers = sm.getAllActiveLayers().map((l) => ({
        priority: `L${l.priority}`,
        state: l.state,
        elapsed: Math.round(l.elapsed * 100) / 100,
      }));
      const transitions = sm.getAllTransitions().map((t: ActiveTransition) => {
        const dur = t.duration > 0 ? t.duration : 1;
        return {
          priority: `L${t.priority}`,
          from: t.from,
          to: t.to,
          progress: Math.round((Math.min(t.elapsed / dur, 1)) * 100) / 100,
        };
      });
      const queues = [BlendPriority.Base, BlendPriority.Workflow, BlendPriority.HighAction, BlendPriority.Interrupt, BlendPriority.Emergency]
        .map((p) => ({ priority: `L${p}`, length: sm.getQueueLength(p) }))
        .filter((q) => q.length > 0);
      setActiveLayers(layers);
      setActiveTransitions(transitions);
      setQueueStatus(queues);
    };

    const unsub = engine.on((event) => {
      const timestamp = new Date().toLocaleTimeString();
      const entry = `[${timestamp}] [${event.type}] ${JSON.stringify(event)}`;
      setEventLog(prev => [...prev.slice(-(EVENT_LOG_MAX - 1)), entry]);

      if (event.type === "state:entered" || event.type === "state:exited" ||
          event.type === "transition:start" || event.type === "transition:complete" ||
          event.type === "transition:cancelled" || event.type === "queue:changed") {
        refreshSM();
      }

      if (event.type === "state:entered") {
        setCurrentState(event.state);
        setCurrentMotion(event.state);
        const expressionMap: Record<string, string> = {
          IDLE: "Neutral", TALKING: "Happy", READING: "Thinking",
          THINKING: "Thinking", GREETING: "Confident", WAKE: "Confident",
          SLEEP: "Sleepy", EMBARRASSED: "Embarrassed", HAPPY: "Happy",
          CONFUSED: "Concerned", ERROR: "Concerned", CODING: "Focused",
          COMPILING: "Thinking", DEBUGGING: "Focused", SEARCHING: "Curious",
          NOTIFICATION: "Curious",
        };
        setCurrentExpression(expressionMap[event.state] || "Neutral");
      }
    });

    return () => {
      unsub();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      fpsFrames.current.push(dt);
      while (fpsFrames.current.length > FPS_HISTORY_MAX) {
        fpsFrames.current.shift();
      }
      if (now - lastFpsTime.current >= 500) {
        const avg = fpsFrames.current.reduce((a, b) => a + b, 0) / fpsFrames.current.length;
        setFrameTime(Math.round(avg * 100) / 100);
        setFps(Math.round(1000 / avg));
        lastFpsTime.current = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const triggerMotion = useCallback((state: AnimationState) => {
    engineRef.current?.setState(state);
  }, []);

  const setExpression = useCallback((expr: string) => {
    setCurrentExpression(expr);
  }, []);

  const handleParamChange = useCallback((key: string, value: number) => {
    setParamValues(prev => ({ ...prev, [key]: value }));
    engineRef.current?.setDebugParam(key, value);
  }, []);

  const handlePhysicsChange = useCallback((key: string, value: number) => {
    setPhysicsValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleResetState = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.clearDebugParams();
      engineRef.current.setState(AnimationState.Idle);
    }
    setParamValues({});
    setCurrentExpression("Neutral");
    setCurrentEmotion("idle");
  }, []);

  const Section: FC<{ id: string; label: string; children: ReactNode }> = ({ id, label, children }) => {
    const open = expandedSections.has(id);
    return (
      <div className="border-b border-white/5">
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition cursor-pointer text-left"
        >
          <span className="text-[10px] font-bold font-mono tracking-widest text-cyan-400">{label}</span>
          <span className="text-white/30 text-xs">{open ? "−" : "+"}</span>
        </button>
        {open && <div className="px-4 pb-3 space-y-2">{children}</div>}
      </div>
    );
  };

  const Slider = ({
    label, value, min, max, step, onChange, disabled = false,
  }: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; disabled?: boolean; key?: string;
  }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-white/70">{label}</span>
        <span className="text-cyan-300 font-mono">{disabled ? "—" : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={disabled ? 0 : value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-1 appearance-none bg-white/10 rounded-full outline-none
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
          [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(34,211,238,0.5)]
          disabled:opacity-30 disabled:cursor-not-allowed"
      />
    </div>
  );

  const MotionButton = ({ label, state, color = "cyan" }: { label: string; state: AnimationState; color?: string }) => {
    const colorMap: Record<string, string> = {
      cyan: "border-cyan-500/20 hover:border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10",
      amber: "border-amber-500/20 hover:border-amber-400/40 text-amber-300 hover:bg-amber-500/10",
      rose: "border-rose-500/20 hover:border-rose-400/40 text-rose-300 hover:bg-rose-500/10",
      emerald: "border-emerald-500/20 hover:border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10",
    };
    return (
      <button
        onClick={() => triggerMotion(state)}
        className={`w-full px-3 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition cursor-pointer ${colorMap[color] || colorMap.cyan} ${
          currentState === state ? "bg-white/10 border-white/30 text-white" : ""
        }`}
      >
        {label}
      </button>
    );
  };

  const ExpressionButton = ({ label }: { label: string; key?: string }) => (
    <button
      onClick={() => setExpression(label)}
      className={`w-full px-3 py-1.5 rounded-lg border text-[11px] font-mono font-medium transition cursor-pointer ${
        currentExpression === label
          ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-300"
          : "border-white/10 hover:border-white/30 text-white/70 hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-screen w-screen bg-[#020205] text-white grid select-none"
      style={{
        gridTemplateColumns: "240px 1fr 320px",
        gridTemplateRows: "1fr 200px",
        gridTemplateAreas: `
          "sidebar main right"
          "console console console"
        `,
      }}
    >
      {/* ===== LEFT SIDEBAR ===== */}
      <div className="border-r border-white/5 overflow-y-auto" style={{ gridArea: "sidebar" }}>
        <div className="p-4 border-b border-white/5">
          <h1 className="text-xs font-bold font-mono tracking-[0.3em] text-cyan-400">AVATAR LAB</h1>
          <p className="text-[9px] text-white/30 font-mono mt-1">v1.0 — Development Console</p>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Avatar View</div>
          <div className="space-y-1.5">
            <InfoRow label="Renderer" value={rendererType} />
            <InfoRow label="FPS" value={`${fps}`} />
            <InfoRow label="Frame Time" value={`${frameTime}ms`} />
            <InfoRow label="Model" value={modelStatus} />
            <InfoRow label="State" value={currentState} />
            <InfoRow label="Motion" value={currentMotion} />
            <InfoRow label="Expression" value={currentExpression} />
            <InfoRow label="Emotion" value={currentEmotion} />
          </div>
        </div>
      </div>

      {/* ===== MAIN AVATAR AREA ===== */}
      <div className="relative flex items-center justify-center overflow-hidden bg-[#010103]" style={{ gridArea: "main" }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.03),transparent_60%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.008)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
        <div className="w-full h-full max-w-[600px] max-h-[600px]">
          <AvatarCanvas engine={engineRef.current} />
        </div>
        <div className="absolute top-3 left-3 text-[9px] font-mono text-white/20 tracking-widest pointer-events-none">
          Addy — LIVE PREVIEW
        </div>
      </div>

      {/* ===== RIGHT DEVELOPER INSPECTOR ===== */}
      <div className="border-l border-white/5 overflow-y-auto bg-[#050510]" style={{ gridArea: "right" }}>
        {SECTIONS.map(({ id, label }) => (
          <Section key={id} id={id} label={label}>
            {id === "avatar-info" && (
              <div className="space-y-1.5 text-[11px] font-mono">
                <InfoRow label="Current Renderer" value={rendererType} />
                <InfoRow label="FPS" value={`${fps}`} />
                <InfoRow label="Frame Time" value={`${frameTime}ms`} />
                <InfoRow label="Model Status" value={modelStatus} />
                <InfoRow label="Current Motion" value={currentMotion} />
                <InfoRow label="Current Expression" value={currentExpression} />
                <InfoRow label="Current Emotion" value={currentEmotion} />
                <InfoRow label="Current State" value={currentState} />
              </div>
            )}

            {id === "statemachine" && (
              <div className="space-y-3 text-[11px] font-mono">
                <div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider mb-1.5">Active Layers</div>
                  {activeLayers.length === 0 && <div className="text-white/20 italic">No active layers</div>}
                  {activeLayers.map((l) => (
                    <div key={l.priority} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03] mb-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-cyan-500/60 font-bold">{l.priority}</span>
                        <span className="text-white/90">{l.state}</span>
                      </div>
                      <span className="text-[9px] text-white/40">{l.elapsed.toFixed(1)}s</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="text-[9px] text-white/40 uppercase tracking-wider mb-1.5">Active Transitions</div>
                  {activeTransitions.length === 0 && <div className="text-white/20 italic">No active transitions</div>}
                  {activeTransitions.map((t) => (
                    <div key={t.priority} className="space-y-1 py-1.5 px-2 rounded bg-white/[0.03] mb-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-amber-500/60 font-bold">{t.priority}</span>
                          <span className="text-white/50 text-[10px]">{t.from ?? "—"}</span>
                          <span className="text-white/30">→</span>
                          <span className="text-cyan-300 text-[10px] font-bold">{t.to}</span>
                        </div>
                        <span className="text-[9px] text-white/40">{(t.progress * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full transition-none"
                          style={{ width: `${t.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {queueStatus.length > 0 && (
                  <div>
                    <div className="text-[9px] text-white/40 uppercase tracking-wider mb-1.5">Queued</div>
                    {queueStatus.map((q) => (
                      <div key={q.priority} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03] mb-0.5">
                        <span className="text-[9px] text-amber-500/60 font-bold">{q.priority}</span>
                        <span className="text-white/80">{q.length} transition{q.length > 1 ? "s" : ""} queued</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {id === "motion" && (
              <div className="grid grid-cols-2 gap-1.5">
                <MotionButton label="Idle" state={AnimationState.Idle} color="cyan" />
                <MotionButton label="Greeting" state={AnimationState.Greeting} color="emerald" />
                <MotionButton label="Thinking" state={AnimationState.Thinking} color="amber" />
                <MotionButton label="Reading" state={AnimationState.Reading} color="cyan" />
                <MotionButton label="Talking" state={AnimationState.Talking} color="emerald" />
                <MotionButton label="Happy" state={AnimationState.Happy} color="emerald" />
                <MotionButton label="Error" state={AnimationState.Error} color="rose" />
                <MotionButton label="Sleep" state={AnimationState.Sleep} color="cyan" />
                <div className="col-span-2 mt-1 space-y-1">
                  <button
                    onClick={() => engineRef.current?.cancelTransition()}
                    className="w-full px-3 py-1.5 rounded-lg border border-amber-500/20 hover:border-amber-400/40 text-amber-300 hover:bg-amber-500/10 text-[11px] font-mono font-medium transition cursor-pointer"
                  >
                    Cancel All Transitions
                  </button>
                  <button
                    onClick={handleResetState}
                    className="w-full px-3 py-1.5 rounded-lg border border-rose-500/20 hover:border-rose-400/40 text-rose-300 hover:bg-rose-500/10 text-[11px] font-mono font-medium transition cursor-pointer"
                  >
                    Reset State
                  </button>
                </div>
              </div>
            )}

            {id === "expression" && (
              <div className="grid grid-cols-2 gap-1.5">
                {["Neutral", "Happy", "Thinking", "Embarrassed", "Concerned", "Confident", "Sleepy", "Curious", "Focused"].map((expr) => (
                  <ExpressionButton key={expr} label={expr} />
                ))}
              </div>
            )}

            {id === "params" && (
              <div className="space-y-2.5">
                {LAB_PARAMS.map((p) => (
                  <Slider
                    key={p.key}
                    label={p.label}
                    value={paramValues[p.key] ?? 0}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onChange={(v) => handleParamChange(p.key, v)}
                  />
                ))}
              </div>
            )}

            {id === "physics" && (
              <div className="space-y-2.5">
                {PHYSICS_PARAMS.map((p) => (
                  <Slider
                    key={p.key}
                    label={p.label}
                    value={physicsValues[p.key] ?? 0}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onChange={(v) => handlePhysicsChange(p.key, v)}
                    disabled={false}
                  />
                ))}
              </div>
            )}

            {id === "debug" && (
              <div className="space-y-1.5 text-[11px] font-mono">
                <InfoRow label="Current Renderer" value={rendererType} />
                <InfoRow label="Active Layers" value={`${activeLayers.length}`} />
                <InfoRow label="Active Transitions" value={`${activeTransitions.length}`} />
                <InfoRow label="Queued Transitions" value={`${queueStatus.reduce((s, q) => s + q.length, 0)}`} />
                <InfoRow label="Event History" value={`${eventLog.length} entries`} />
                <InfoRow label="Performance" value={`${fps} FPS / ${frameTime}ms`} />
              </div>
            )}
          </Section>
        ))}
      </div>

      {/* ===== CONSOLE / EVENT LOG ===== */}
      <div className="border-t border-white/5 flex flex-col bg-[#050510]" style={{ gridArea: "console" }}>
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/5">
          <span className="text-[10px] font-bold font-mono tracking-widest text-cyan-400/70">EVENT LOG</span>
          <span className="text-[9px] font-mono text-white/30">{eventLog.length} events</span>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-[10px] leading-relaxed">
          {eventLog.length === 0 && (
            <div className="text-white/20 italic p-2">No events yet. Trigger motions or adjust params...</div>
          )}
          {eventLog.map((entry, i) => (
            <div key={i} className="text-white/60 hover:text-white/90 transition">
              {entry.length > 180 ? entry.slice(0, 180) + "…" : entry}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/50">{label}</span>
      <span className="text-white/90 font-medium truncate ml-2 text-right max-w-[140px]">{value}</span>
    </div>
  );
}
