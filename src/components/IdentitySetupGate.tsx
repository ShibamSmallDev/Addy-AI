import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Sparkles, Heart, Loader2, User, Bot, ArrowRight } from "lucide-react";
import { saveSettings } from "../lib/settingsStore";

type Phase = "checking" | "needsSetup" | "ready";

export function IdentitySetupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [assistantName, setAssistantName] = useState("Adrija");
  const [userName, setUserName] = useState("Shibam");
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
            assistantName: data.assistantName || "Addy",
            userName: data.userName || "Shibam",
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
    const aiName = assistantName.trim() || "Addy";
    const uName = userName.trim() || "Shibam";
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
          className="relative z-10 w-[min(92vw,480px)] rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_30px_90px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500/30 to-cyan-500/20 ring-1 ring-white/10 shadow-[0_0_25px_rgba(244,114,182,0.3)]">
              <Heart className="h-8 w-8 text-pink-300 fill-pink-400/40 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Meet Your Companion <Sparkles size={18} className="text-pink-400" />
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300 font-mono">
              Give your personal AI companion a name and tell her what she should call you. These will be kept in permanent memory until changed.
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
                placeholder="e.g. Adrija, Addy, Luna, Maya"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white font-mono outline-none transition focus:border-pink-400/70 focus:ring-2 focus:ring-pink-500/20"
              />
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono text-slate-500">Suggestions:</span>
                {["Adrija", "Addy", "Luna", "Maya"].map((name) => (
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
                    {name === "Adrija" ? "✨ Adrija" : name === "Addy" ? "🌸 Addy" : name}
                  </button>
                ))}
              </div>
            </div>

            {/* User Name Input */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
                <User size={13} /> Your Name
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g. Shibam"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white font-mono outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/20"
              />
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono text-slate-500">Suggestion:</span>
                {["Shibam"].map((name) => (
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
                    👤 Shibam
                  </button>
                ))}
              </div>
            </div>

            {/* Warm Emotional Girl Companion Highlight Badge */}
            <div className="p-3.5 rounded-2xl border border-pink-500/25 bg-pink-500/10 flex items-start gap-2.5">
              <Heart size={15} className="text-pink-400 fill-pink-400 shrink-0 mt-0.5" />
              <div className="text-[11px] font-mono text-pink-200/90 leading-snug">
                <span className="font-bold text-pink-100">Warm Emotional Girl Structure:</span> She is caring, playfully expressive, comforts you when you're stressed, celebrates your wins, and speaks with genuine heartfelt affection.
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
