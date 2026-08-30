import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Sparkles, Heart, Loader2, User, Bot, ArrowRight, Zap, Smile } from "lucide-react";
import { saveSettings } from "../lib/settingsStore";

type Phase = "checking" | "needsSetup" | "ready";
type PersonalityStyle = "warm_girl" | "playful" | "cyberpunk";

export function IdentitySetupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [assistantName, setAssistantName] = useState("Adri");
  const [userName, setUserName] = useState("Master");
  const [personality, setPersonality] = useState<PersonalityStyle>("warm_girl");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/identity", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data.hasSetup) {
          saveSettings({
            assistantName: data.assistantName || "Adri",
            userName: data.userName || "Master",
          });
          setPhase("ready");
        } else {
          setPhase("needsSetup");
        }
      } catch {
        if (!cancelled) setPhase("needsSetup");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const aiName = assistantName.trim() || "Adri";
    const uName = userName.trim() || "Master";
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantName: aiName,
          userName: uName,
          companionMode: true,
          personalityStyle: personality,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save companion identity.");

      saveSettings({
        assistantName: aiName,
        userName: uName,
        companionMode: true,
      });

      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "ready") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050509] text-white">
      {/* Ambient glowing orbs matching the companion aesthetic */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[450px] w-[450px] rounded-full bg-pink-600/15 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-cyan-600/15 blur-[150px]" />

      {phase === "checking" ? (
        <div className="flex flex-col items-center gap-4 text-white/60">
          <Loader2 className="h-7 w-7 animate-spin text-pink-400" />
          <span className="text-sm font-mono tracking-wide">Connecting to companion core…</span>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="relative z-10 w-[min(92vw,500px)] rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_30px_90px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500/30 to-cyan-500/20 ring-1 ring-white/10 shadow-[0_0_25px_rgba(244,114,182,0.3)]">
              <Heart className="h-8 w-8 text-pink-300 fill-pink-400/40 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Meet Your Companion <Sparkles size={18} className="text-pink-400" />
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300 font-mono">
              Name your AI assistant and choose how she will address you. These are stored locally and anchored into permanent memory.
            </p>
          </div>

          <div className="space-y-4">
            {/* AI Assistant Name Input */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-pink-300">
                <Bot size={13} /> AI Companion Name
              </label>
              <input
                type="text"
                autoFocus
                value={assistantName}
                onChange={(e) => setAssistantName(e.target.value)}
                placeholder="e.g. Adri, Addy, Luna"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm text-white font-mono outline-none transition focus:border-pink-400/70 focus:ring-2 focus:ring-pink-500/20"
              />
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono text-slate-500">Suggestions:</span>
                {["Adri", "Addy", "Luna", "Maya"].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setAssistantName(name)}
                    className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono transition cursor-pointer ${
                      assistantName.toLowerCase() === name.toLowerCase()
                        ? "border-pink-400 bg-pink-500/20 text-pink-300 font-bold"
                        : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {name === "Adri" ? "✨ Adri" : name === "Addy" ? "🌸 Addy" : name}
                  </button>
                ))}
              </div>
            </div>

            {/* User Name Input */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
                <User size={13} /> Your Name / Title
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g. Master, Boss"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm text-white font-mono outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/20"
              />
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono text-slate-500">Suggestions:</span>
                {["Master", "Boss"].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setUserName(name)}
                    className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono transition cursor-pointer ${
                      userName.toLowerCase() === name.toLowerCase()
                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 font-bold"
                        : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {name === "Master" ? "👑 Master" : "💼 Boss"}
                  </button>
                ))}
              </div>
            </div>

            {/* Personality Style Selector */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-300">
                Personality &amp; Emotional Structure
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPersonality("warm_girl")}
                  className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 transition cursor-pointer ${
                    personality === "warm_girl"
                      ? "border-pink-400 bg-pink-500/20 text-pink-200"
                      : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <Heart size={14} className={personality === "warm_girl" ? "text-pink-400 fill-pink-400" : "text-slate-400"} />
                  <span className="text-[10px] font-mono font-bold">Warm Girl</span>
                  <span className="text-[8px] font-mono text-slate-400 leading-tight">Loving, comforting, anime warmth</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPersonality("playful")}
                  className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 transition cursor-pointer ${
                    personality === "playful"
                      ? "border-amber-400 bg-amber-500/20 text-amber-200"
                      : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <Smile size={14} className={personality === "playful" ? "text-amber-400" : "text-slate-400"} />
                  <span className="text-[10px] font-mono font-bold">Playful</span>
                  <span className="text-[8px] font-mono text-slate-400 leading-tight">Cheeky, teasing, high-energy</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPersonality("cyberpunk")}
                  className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 transition cursor-pointer ${
                    personality === "cyberpunk"
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                      : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <Zap size={14} className={personality === "cyberpunk" ? "text-cyan-400" : "text-slate-400"} />
                  <span className="text-[10px] font-mono font-bold">Cyberpunk</span>
                  <span className="text-[8px] font-mono text-slate-400 leading-tight">Tech co-pilot, hacker vibes</span>
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/20 font-mono">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !assistantName.trim() || !userName.trim()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-500 px-4 py-3.5 text-sm font-bold font-mono uppercase tracking-widest text-white shadow-lg shadow-pink-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Awakening Her…
              </>
            ) : (
              <>
                Awaken {assistantName || "Her"} <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
