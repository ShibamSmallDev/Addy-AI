import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Sparkles,
  Cog,
  Cpu,
  Image,
  Terminal,
  Waypoints,
  FolderKanban,
  Blocks,
  Play,
  Square,
  RefreshCw,
  Check,
  AlertTriangle,
  Globe,
  FileText,
  Trash2,
  ExternalLink,
  List,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DevPanelProps {
  isOpen: boolean;
  onClose: () => void;
  themeColor: string;
}

type DevTab = "agent" | "artifacts" | "image" | "terminal" | "providers" | "workspace" | "orchestration";

const getBadgeStyle = (themeColor: string) => {
  switch (themeColor) {
    case "violet": return "border-purple-500/30 text-purple-400 bg-purple-500/10";
    case "crimson": return "border-rose-500/30 text-rose-400 bg-rose-500/10";
    case "emerald": return "border-emerald-500/30 text-emerald-400 bg-emerald-500/10";
    case "celestial": return "border-sky-500/30 text-sky-400 bg-sky-500/10";
    case "gold": return "border-amber-500/30 text-amber-400 bg-amber-500/10";
    case "rose": return "border-pink-500/30 text-pink-400 bg-pink-500/10";
    default: return "border-indigo-500/30 text-indigo-400 bg-indigo-500/10";
  }
};

function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between text-left">
      <div className="flex flex-col">
        <span className="text-[10px] font-bold font-mono text-slate-200">{label}</span>
        <span className="text-[8px] text-slate-400 uppercase font-mono max-w-[200px]">{description}</span>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${
          checked ? "bg-cyan-500" : "bg-white/10"
        }`}
      >
        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`} />
      </button>
    </div>
  );
}

export function DevPanel({ isOpen, onClose, themeColor }: DevPanelProps) {
  const [activeTab, setActiveTab] = useState<DevTab>("agent");

  // Agent Loop
  const [agentGoal, setAgentGoal] = useState("");
  const [agentResult, setAgentResult] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Artifacts
  const [artifactType, setArtifactType] = useState("pdf");
  const [artifactDesc, setArtifactDesc] = useState("");
  const [artifactResult, setArtifactResult] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactList, setArtifactList] = useState<any[]>([]);

  // Image Gen
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageResult, setImageResult] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  // Terminal
  const [terminalCmd, setTerminalCmd] = useState("");
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(false);

  // Providers
  const [providers, setProviders] = useState<any>(null);
  const [providerLoading, setProviderLoading] = useState(false);

  // Workspace
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceResult, setWorkspaceResult] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [editors, setEditors] = useState<string[]>([]);
  const [recentProjects, setRecentProjects] = useState<any[]>([]);

  // Orchestration
  const [orchestrateTask, setOrchestrateTask] = useState("");
  const [orchestrateResult, setOrchestrateResult] = useState<string | null>(null);
  const [orchestrateLoading, setOrchestrateLoading] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<any[]>([]);

  // Cleanup agent poll on unmount
  useEffect(() => {
    return () => {
      if (agentPollRef.current) clearInterval(agentPollRef.current);
    };
  }, []);

  const stopAgentPoll = () => {
    if (agentPollRef.current) {
      clearInterval(agentPollRef.current);
      agentPollRef.current = null;
    }
  };

  // ---- Agent Loop ----
  const startAgent = async () => {
    if (!agentGoal.trim()) return;
    setAgentLoading(true);
    setAgentResult(null);
    setAgentStatus(null);
    stopAgentPoll();
    try {
      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: agentGoal }),
      });
      const data = await res.json();
      if (data.id) {
        setAgentId(data.id);
        setAgentStatus("started");
        agentPollRef.current = setInterval(async () => {
          try {
            const r = await fetch(`/api/agent/${data.id}`);
            const s = await r.json();
            setAgentStatus(s.status || s.state);
            setAgentResult(JSON.stringify(s, null, 2));
            if (s.status === "completed" || s.status === "error" || s.state === "completed" || s.state === "error") {
              stopAgentPoll();
            }
          } catch { /* ignore */ }
        }, 2000);
      } else {
        setAgentResult(data.error || "Unknown response");
      }
    } catch (e: any) {
      setAgentResult(`Error: ${e.message}`);
    } finally {
      setAgentLoading(false);
    }
  };

  const abortAgent = async () => {
    if (!agentId) return;
    stopAgentPoll();
    try {
      const res = await fetch(`/api/agent/${agentId}/abort`, { method: "POST" });
      const data = await res.json();
      setAgentResult(data.ok ? "Aborted" : "Abort failed");
      setAgentStatus("aborted");
    } catch (e: any) {
      setAgentResult(`Error: ${e.message}`);
    }
  };

  // ---- Artifacts ----
  const generateArtifact = async () => {
    if (!artifactDesc.trim()) return;
    setArtifactLoading(true);
    setArtifactResult(null);
    try {
      const res = await fetch("/api/artifacts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: artifactType, name: artifactDesc.slice(0, 40), content: artifactDesc }),
      });
      const data = await res.json();
      setArtifactResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setArtifactResult(`Error: ${e.message}`);
    } finally {
      setArtifactLoading(false);
    }
  };

  const listArtifacts = async () => {
    try {
      const res = await fetch("/api/artifacts");
      const data = await res.json();
      setArtifactList(Array.isArray(data) ? data : []);
    } catch { setArtifactList([]); }
  };

  const deleteArtifact = async (id: string) => {
    try {
      await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
      listArtifacts();
    } catch { /* ignore */ }
  };

  // ---- Image Gen ----
  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    setImageLoading(true);
    setImageResult(null);
    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      const data = await res.json();
      setImageResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setImageResult(`Error: ${e.message}`);
    } finally {
      setImageLoading(false);
    }
  };

  // ---- Terminal ----
  const executeCommand = async () => {
    if (!terminalCmd.trim()) return;
    setTerminalLoading(true);
    setTerminalOutput(null);
    try {
      const res = await fetch("/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: terminalCmd }),
      });
      const data = await res.json();
      setTerminalOutput(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setTerminalOutput(`Error: ${e.message}`);
    } finally {
      setTerminalLoading(false);
    }
  };

  // ---- Providers ----
  const fetchProviders = async () => {
    setProviderLoading(true);
    try {
      const [pRes, hRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/providers/health"),
      ]);
      const pData = await pRes.json();
      const hData = await hRes.json();
      setProviders({ ...pData, health: hData });
    } catch { setProviders({ error: "Failed to fetch" }); }
    finally { setProviderLoading(false); }
  };

  const switchProvider = async (name: string) => {
    try {
      const res = await fetch("/api/providers/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: name }),
      });
      const data = await res.json();
      if (data.ok) fetchProviders();
    } catch { /* ignore */ }
  };

  // ---- Workspace ----
  const detectProject = async () => {
    if (!workspacePath.trim()) return;
    setWorkspaceLoading(true);
    setWorkspaceResult(null);
    try {
      const res = await fetch("/api/workspace/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspacePath }),
      });
      const data = await res.json();
      setWorkspaceResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setWorkspaceResult(`Error: ${e.message}`);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const fetchEditors = async () => {
    try {
      const res = await fetch("/api/workspace/editors");
      const data = await res.json();
      setEditors(Array.isArray(data) ? data : []);
    } catch { setEditors([]); }
  };

  const fetchRecentProjects = async () => {
    try {
      const res = await fetch("/api/workspace/recent", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      setRecentProjects(Array.isArray(data) ? data : []);
    } catch { setRecentProjects([]); }
  };

  // ---- Orchestration ----
  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/orchestration/agents");
      const data = await res.json();
      setAvailableAgents(Array.isArray(data) ? data : []);
    } catch { setAvailableAgents([]); }
  };

  const delegateTask = async () => {
    if (!orchestrateTask.trim()) return;
    setOrchestrateLoading(true);
    setOrchestrateResult(null);
    try {
      const res = await fetch("/api/orchestration/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: orchestrateTask }),
      });
      const data = await res.json();
      setOrchestrateResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setOrchestrateResult(`Error: ${e.message}`);
    } finally {
      setOrchestrateLoading(false);
    }
  };

  const tabs: { id: DevTab; label: string; icon: any }[] = [
    { id: "agent", label: "AGENT", icon: Cpu },
    { id: "artifacts", label: "ARTIFACTS", icon: FileText },
    { id: "image", label: "IMAGE", icon: Image },
    { id: "terminal", label: "TERMINAL", icon: Terminal },
    { id: "providers", label: "PROVIDERS", icon: Waypoints },
    { id: "workspace", label: "WORKSPACE", icon: FolderKanban },
    { id: "orchestration", label: "ORCHESTRATE", icon: Blocks },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-y-0 right-0 w-full max-w-lg bg-[#020206]/95 border-l border-white/15 backdrop-blur-2xl z-50 flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.8)]"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${getBadgeStyle(themeColor)}`}>
                  <Cog size={22} className="animate-spin [animation-duration:8s]" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-lg tracking-tight text-white flex items-center gap-2">
                    Addy Developer Tools
                    <Sparkles size={14} className="text-cyan-400" />
                  </h3>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mt-0.5">
                    Test all subsystems
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tab selector */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2 overflow-x-auto no-scrollbar">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono tracking-wider transition shrink-0 cursor-pointer ${
                      active
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                        : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    <Icon size={12} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* ========== AGENT LOOP ========== */}
              {activeTab === "agent" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Autonomous Agent Loop
                  </div>
                  <textarea
                    value={agentGoal}
                    onChange={(e) => setAgentGoal(e.target.value)}
                    placeholder="Describe a goal for the agent to complete..."
                    rows={3}
                    className="w-full p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 resize-none font-sans"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={startAgent}
                      disabled={agentLoading || !agentGoal.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                    >
                      <Play size={12} />
                      {agentLoading ? "Starting..." : "Start Agent"}
                    </button>
                    {agentId && (
                      <button
                        onClick={abortAgent}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-mono tracking-wider transition cursor-pointer"
                      >
                        <Square size={10} />
                        Abort
                      </button>
                    )}
                  </div>
                  {agentStatus && (
                    <div className={`p-3 rounded-xl border text-[10px] font-mono ${
                      agentStatus === "completed" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" :
                      agentStatus === "error" || agentStatus === "aborted" ? "border-rose-500/20 bg-rose-500/5 text-rose-300" :
                      "border-cyan-500/20 bg-cyan-500/5 text-cyan-300"
                    }`}>
                      Status: {agentStatus}
                    </div>
                  )}
                  {agentResult && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/60 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {agentResult}
                    </pre>
                  )}
                </div>
              )}

              {/* ========== ARTIFACTS ========== */}
              {activeTab === "artifacts" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Generate Artifact
                  </div>
                  <div className="flex gap-2">
                    {["pdf", "docx", "xlsx", "pptx", "zip"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setArtifactType(t)}
                        className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono tracking-wider uppercase transition cursor-pointer ${
                          artifactType === t
                            ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                            : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={artifactDesc}
                    onChange={(e) => setArtifactDesc(e.target.value)}
                    placeholder="Describe what you want to generate (e.g. 'A one-page PDF invoice with my company logo')"
                    rows={3}
                    className="w-full p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 resize-none font-sans"
                  />
                  <button
                    onClick={generateArtifact}
                    disabled={artifactLoading || !artifactDesc.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                  >
                    <FileText size={12} />
                    {artifactLoading ? "Generating..." : `Generate ${artifactType.toUpperCase()}`}
                  </button>

                  {artifactResult && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/60 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {artifactResult}
                    </pre>
                  )}

                  <div className="border-t border-white/10 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Saved Artifacts</span>
                      <button onClick={listArtifacts} className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition cursor-pointer">
                        <RefreshCw size={10} /> Refresh
                      </button>
                    </div>
                    {artifactList.length === 0 ? (
                      <p className="text-[10px] font-mono text-slate-500">No artifacts yet. Generate one above.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {artifactList.map((a) => (
                          <div key={a.id} className="flex items-center justify-between p-2 rounded-lg border border-white/5 bg-white/[0.02] text-[10px] font-mono">
                            <span className="text-slate-300 truncate">{a.name || a.id}</span>
                            <button onClick={() => deleteArtifact(a.id)} className="text-rose-400 hover:text-rose-300 cursor-pointer">
                              <Trash2 size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ========== IMAGE GEN ========== */}
              {activeTab === "image" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    AI Image Generation
                  </div>
                  <div className="p-3 rounded-xl border border-amber-500/15 bg-amber-500/5 flex items-start gap-2">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] font-mono text-amber-300/70 leading-relaxed">
                      Uses Gemini Imagen by default, falls back to DALL-E 3.
                    </span>
                  </div>
                  <textarea
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="A serene cyberpunk cityscape at dusk, neon lights reflecting on wet pavement..."
                    rows={3}
                    className="w-full p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 resize-none font-sans"
                  />
                  <button
                    onClick={generateImage}
                    disabled={imageLoading || !imagePrompt.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                  >
                    <Image size={12} />
                    {imageLoading ? "Generating..." : "Generate Image"}
                  </button>
                  {imageResult && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/60 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {imageResult}
                    </pre>
                  )}
                </div>
              )}

              {/* ========== TERMINAL ========== */}
              {activeTab === "terminal" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Command Execution
                  </div>
                  <div className="p-3 rounded-xl border border-rose-500/15 bg-rose-500/5 flex items-start gap-2">
                    <AlertTriangle size={12} className="text-rose-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] font-mono text-rose-300/70 leading-relaxed">
                      Commands are classified for safety. Dangerous commands may be blocked.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={terminalCmd}
                      onChange={(e) => setTerminalCmd(e.target.value)}
                      placeholder="e.g. dir src /b"
                      className="flex-1 p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 font-mono"
                      onKeyDown={(e) => e.key === "Enter" && executeCommand()}
                    />
                  </div>
                  <button
                    onClick={executeCommand}
                    disabled={terminalLoading || !terminalCmd.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                  >
                    <Terminal size={12} />
                    {terminalLoading ? "Running..." : "Execute"}
                  </button>
                  {terminalOutput && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/80 text-[10px] font-mono text-green-300 overflow-x-auto max-h-64 whitespace-pre-wrap">
                      {terminalOutput}
                    </pre>
                  )}
                </div>
              )}

              {/* ========== PROVIDERS ========== */}
              {activeTab === "providers" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    AI Provider Management
                  </div>
                  <button
                    onClick={fetchProviders}
                    disabled={providerLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 transition cursor-pointer"
                  >
                    <RefreshCw size={12} className={providerLoading ? "animate-spin" : ""} />
                    {providerLoading ? "Fetching..." : "Fetch Provider Status"}
                  </button>
                  {providers && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl border border-white/10 bg-black/40 text-[10px] font-mono space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Active Provider</span>
                          <span className="text-cyan-300 font-bold">{providers.active}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Available</span>
                          <span className="text-slate-300">{providers.providers?.join(", ")}</span>
                        </div>
                      </div>
                      {providers.providers?.map((name: string) => (
                        <div key={name} className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/[0.02]">
                          <span className="text-xs font-mono text-slate-300 uppercase">{name}</span>
                          <div className="flex gap-2">
                            {providers.active !== name && (
                              <button
                                onClick={() => switchProvider(name)}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono hover:bg-cyan-500/20 transition cursor-pointer"
                              >
                                Switch
                              </button>
                            )}
                            <span className={`px-2 py-1.5 rounded-lg text-[10px] font-mono ${
                              providers.health?.[name]?.ok ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                            }`}>
                              {providers.health?.[name]?.ok ? "Healthy" : "Unhealthy"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ========== WORKSPACE ========== */}
              {activeTab === "workspace" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Project & Editor Detection
                  </div>
                  <input
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    placeholder="C:\MY PROJECTS\Addy AI"
                    className="w-full p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={detectProject}
                      disabled={workspaceLoading || !workspacePath.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                    >
                      <FolderKanban size={12} />
                      {workspaceLoading ? "Detecting..." : "Detect Project"}
                    </button>
                    <button
                      onClick={fetchEditors}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 transition cursor-pointer"
                    >
                      <Globe size={12} /> Editors
                    </button>
                    <button
                      onClick={fetchRecentProjects}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 transition cursor-pointer"
                    >
                      <List size={12} /> Recent
                    </button>
                  </div>
                  {workspaceResult && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/60 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {workspaceResult}
                    </pre>
                  )}
                  {editors.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Detected Editors</span>
                      {editors.map((e, i) => (
                        <div key={i} className="p-2 rounded-lg border border-white/5 bg-white/[0.02] text-[10px] font-mono text-slate-300">
                          {e}
                        </div>
                      ))}
                    </div>
                  )}
                  {recentProjects.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Recent Projects</span>
                      {recentProjects.slice(0, 5).map((p, i) => (
                        <div key={i} className="p-2 rounded-lg border border-white/5 bg-white/[0.02] text-[10px] font-mono text-slate-300 truncate">
                          {p.name || p.path || p}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ========== ORCHESTRATION ========== */}
              {activeTab === "orchestration" && (
                <div className="space-y-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                    Coding Agent Orchestration
                  </div>
                  <button
                    onClick={fetchAgents}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 transition cursor-pointer"
                  >
                    <RefreshCw size={12} /> Detect Available Agents
                  </button>
                  {availableAgents.length > 0 && (
                    <div className="space-y-1.5">
                      {availableAgents.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-[10px] font-mono">
                          <Check size={10} className="text-emerald-400" />
                          <span className="text-slate-300">{a.name || a}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={orchestrateTask}
                    onChange={(e) => setOrchestrateTask(e.target.value)}
                    placeholder="Describe a coding task to delegate to an available agent..."
                    rows={3}
                    className="w-full p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 resize-none font-sans"
                  />
                  <button
                    onClick={delegateTask}
                    disabled={orchestrateLoading || !orchestrateTask.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase font-mono tracking-widest transition disabled:opacity-50 cursor-pointer"
                  >
                    <Blocks size={12} />
                    {orchestrateLoading ? "Delegating..." : "Delegate Task"}
                  </button>
                  {orchestrateResult && (
                    <pre className="p-3 rounded-xl border border-white/10 bg-black/60 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {orchestrateResult}
                    </pre>
                  )}
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/5 bg-white/5 flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                Tool connections: live
              </span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
                PHASE 3
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
