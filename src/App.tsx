import { useState, useEffect, useRef, useCallback } from "react";
import { AddyAudioSession, LiveState } from "./lib/audio";
import { AddyCoreVisualizer, AddyEmotion } from "./components/AddyCoreVisualizer";
import { 
  Power, 
  Volume2, 
  Info, 
  Sparkles, 
  Globe, 
  MessageSquareOff, 
  CircleAlert,
  MicOff,
  Mic,
  X,
  Brain,
  Clock,
  Monitor,
  Play,
  Pause,
  Square,
  RefreshCw,
  ExternalLink,
  Send,
  Settings as SettingsIcon,
  Cog as CogIcon,
  Terminal,
  MessageSquare,
  Shield,
  Compass,
  Flame,
  Radio,
  HardDrive,
  LayoutGrid,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Memory, MemoryCategory } from "./lib/memoryTypes";
import { MemoryDashboard } from "./components/MemoryDashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { DevPanel } from "./components/DevPanel";
import { DesktopPanel } from "./components/DesktopPanel";
import { SessionManagerPanel } from "./components/SessionManagerPanel";
import { TextChatPanel, ChatMessage } from "./components/TextChatPanel";
import { AddySettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from "./lib/settingsStore";
import { AddyWakeWordDetector } from "./lib/wakeWord";
import { filterToolCallLeakage } from "./lib/textSanitizer";

export default function App() {
  const [state, setState] = useState<LiveState>("disconnected");
  const stateRef = useRef<LiveState>("disconnected");

  // True when the user voice-commanded "stop listening": Addy goes dormant
  // (no listening, no responding) but the wake word stays armed so calling
  // her name wakes her again.
  const [wakeForced, setWakeForced] = useState(false);
  // Live wake-word detector state, shown in the UI so arming is visible.
  const [wakeState, setWakeState] = useState<string>("stopped");
  useEffect(() => { stateRef.current = state; }, [state]);

  // Real-time Screen Sharing states
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isScreenSharingPaused, setIsScreenSharingPaused] = useState<boolean>(false);
  const [screenVisionMode, setScreenVisionMode] = useState<boolean>(true);
  const [show25DDemo, setShow25DDemo] = useState<boolean>(true);

  // References to preserve state across intervals
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenIntervalRef = useRef<any>(null);

  const isPausedRef = useRef<boolean>(false);
  const screenVisionRef = useRef<boolean>(true);
  // Sync state changes with refs to totally prevent stale closures in callbacks
  useEffect(() => {
    isPausedRef.current = isScreenSharingPaused;
  }, [isScreenSharingPaused]);

  useEffect(() => {
    screenVisionRef.current = screenVisionMode;
  }, [screenVisionMode]);

  // Clean up streaming intervals on unmount
  useEffect(() => {
    return () => {
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
    };
  }, []);

  const captureFrameAndSend = () => {
    const video = screenVideoRef.current;
    if (!video || isPausedRef.current || !screenVisionRef.current) {
      return;
    }

    if (stateRef.current === "disconnected") {
      return;
    }

    try {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (!screenCanvasRef.current) {
        screenCanvasRef.current = document.createElement("canvas");
      }
      const canvas = screenCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Restrict maximum resolution size to keep payload light for Gemini Live
      const maxDim = 960;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(video, 0, 0, width, height);

      // Highly compressed JPEG standard is optimized and preserves details perfectly
      const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
      const base64 = dataUrl.split(",")[1];

      if (sessionRef.current) {
        sessionRef.current.sendVideoFrame(base64);
      }
    } catch (err) {
      console.error("[Screen Capture] Failed drawing frame to canvas:", err);
    }
  };

  const startScreenSharing = async () => {
    setErrorText(null);
    try {
      let stream: MediaStream;

      // Use Electron's desktopCapturer (no permission prompt) when available.
      // Falls back to standard getDisplayMedia (with prompt) in the browser.
      if ((window as any).Addy?.getScreenStream) {
        stream = await (window as any).Addy.getScreenStream();
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 5 } },
          audio: false,
        });
      }

      screenStreamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(e => console.error("Video play warning:", e));
      screenVideoRef.current = video;

      setIsScreenSharing(true);
      setIsScreenSharingPaused(false);

      // Stop handling when native stop sharing bar button ends
      stream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };

      // Set up frame capture interval (one frame every 2 seconds is highly robust, preventing overload)
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
      screenIntervalRef.current = setInterval(() => {
        captureFrameAndSend();
      }, 500);

      // Promptly capture first frame immediately
      setTimeout(() => {
        captureFrameAndSend();
      }, 500);

    } catch (e: any) {
      console.error("Screen sharing permission declined or missing API:", e);
      if (e.name !== "NotAllowedError") {
        setErrorText(`Could not capture screen: ${e.message || e}`);
      }
    }
  };

  const stopScreenSharing = () => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current = null;
    }

    setIsScreenSharing(false);
    setIsScreenSharingPaused(false);
  };

  const pauseScreenSharing = () => {
    setIsScreenSharingPaused(true);
  };

  const resumeScreenSharing = () => {
    setIsScreenSharingPaused(false);
    // Refresh first frame immediately
    setTimeout(() => {
      captureFrameAndSend();
    }, 100);
  };

  const switchScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
    }
    await startScreenSharing();
  };

  const [activeEmotion, setActiveEmotion] = useState<AddyEmotion>("idle");
  const [themeColor, setThemeColor] = useState<string>("charcoal");
  const [userCaption, setUserCaption] = useState<string>("");
  const [characterState, setCharacterState] = useState<"idle" | "thinking" | "talking">("idle");

  const detectEmotionFromText = (text: string): AddyEmotion => {
    const lower = text.toLowerCase();
    if (lower.includes("haha") || lower.includes("lol") || lower.includes("funny") || lower.includes("joke") || lower.includes("hehe") || lower.includes("wink")) return "playful";
    if (lower.includes("happy") || lower.includes("harmony") || lower.includes("glad") || lower.includes("joy") || lower.includes("wonderful") || lower.includes("love") || lower.includes("smile")) return "happy";
    if (lower.includes("wow") || lower.includes("awesome") || lower.includes("excited") || lower.includes("amazing") || lower.includes("yay") || lower.includes("incredible") || lower.includes("hype")) return "excited";
    if (lower.includes("really?") || lower.includes("curious") || lower.includes("interest") || lower.includes("tell me more") || lower.includes("why") || lower.includes("how") || lower.includes("wonder")) return "curious";
    if (lower.includes("think") || lower.includes("calculat") || lower.includes("analyz") || lower.includes("hmmm") || lower.includes("process") || lower.includes("let me see") || lower.includes("conclude")) return "thinking";
    if (lower.includes("proud") || lower.includes("achieved") || lower.includes("expert") || lower.includes("skill") || lower.includes("confidence") || lower.includes("succeed")) return "proud";
    if (lower.includes("sad") || lower.includes("sorry") || lower.includes("unfortunate") || lower.includes("grief") || lower.includes("bad") || lower.includes("regret") || lower.includes("alas") || lower.includes("cry")) return "sad";
    if (lower.includes("shock") || lower.includes("surprise") || lower.includes("gasp") || lower.includes("unexpected") || lower.includes("seriously") || lower.includes("oh my")) return "surprised";
    if (lower.includes("blush") || lower.includes("shy") || lower.includes("embarrass") || lower.includes("nervous") || lower.includes("oops") || lower.includes("sorry about")) return "embarrassed";
    if (lower.includes("what?") || lower.includes("confus") || lower.includes("puzzled") || lower.includes("dont know") || lower.includes("not sure") || lower.includes("wait")) return "confused";
    return "idle";
  };
  const [modelCaption, setModelCaption] = useState<string>("");
  // Auto-fade captions after 7s of inactivity
  const captionFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (captionFadeRef.current) clearTimeout(captionFadeRef.current);
    if (userCaption || modelCaption) {
      captionFadeRef.current = setTimeout(() => {
        setUserCaption("");
        setModelCaption("");
      }, 7000);
    }
    return () => { if (captionFadeRef.current) clearTimeout(captionFadeRef.current); };
  }, [userCaption, modelCaption]);
  const [activeProjectorUrl, setActiveProjectorUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Addy recollections database core state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showMemoryDashboard, setShowMemoryDashboard] = useState<boolean>(false);

  // V2: Settings + wake word state
  const [settings, setSettings] = useState<AddySettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const showSettingsRef = useRef<boolean>(false);
  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);

  const [showDevPanel, setShowDevPanel] = useState<boolean>(false);
  const [showDesktopPanel, setShowDesktopPanel] = useState<boolean>(false);
  const [showSessionManager, setShowSessionManager] = useState<boolean>(false);

  // Microphone mute state: when muted, mic is off but wake word stays active
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const isMicMutedRef = useRef<boolean>(false);
  useEffect(() => { isMicMutedRef.current = isMicMuted; }, [isMicMuted]);

  // V3: Wake word detector instance (smart-home-grade, lives for the app lifetime)
  const wakeDetectorRef = useRef<AddyWakeWordDetector | null>(null);
  // Ref indirection so the wake-word callback always calls the latest connect
  // handler, regardless of where it's declared in the component body.
  const connectHandlerRef = useRef<() => void>(() => {});
  // Mirrors settings for use in the session onStateChange closure (created once on mount).
  const wakeWordEnabledRef = useRef<boolean>(false);
  const wakePhraseRef = useRef<string>("sakura");
  const wakeSensitivityRef = useRef<number>(60);

  // Initialize wake detector once on mount.
  useEffect(() => {
    const det = new AddyWakeWordDetector();
    wakeDetectorRef.current = det;
    return () => {
      det.stop();
    };
  }, []);

  // Start / stop wake word detection when the setting or mute state changes.
  // Wake word stays active even when mic is muted — it auto-activates on trigger.
  useEffect(() => {
    const det = wakeDetectorRef.current;
    if (!det) return;
    wakeWordEnabledRef.current = settings.wakeWordEnabled;
    wakePhraseRef.current = settings.wakePhrase;
    wakeSensitivityRef.current = settings.sensitivity;
    const shouldWake = (settings.wakeWordEnabled || wakeForced) && (state === "disconnected" || isMicMuted);
    if (shouldWake) {
      // 1.5s grace period so trailing speech/echo after "stop listening" does not immediately re-wake her
      const timer = setTimeout(() => {
        det.start({
          phrase: settings.wakePhrase,
          sensitivity: settings.sensitivity,
          onTriggered: () => {
            det.stop();
            // Dormant mode ends the moment she wakes.
            setWakeForced(false);
            // Auto-unmute if muted
            if (isMicMutedRef.current) {
              setIsMicMuted(false);
            }
            connectHandlerRef.current();
          },
          onState: (s) => setWakeState(s),
        });
      }, 1500);
      return () => {
        clearTimeout(timer);
        det.stop();
      };
    } else {
      det.stop();
    }
  }, [settings.wakeWordEnabled, settings.wakePhrase, settings.sensitivity, state, isMicMuted, wakeForced]);

  // Handle settings changes: persist to localStorage + update state.
  const handleSettingsChange = (patch: Partial<AddySettings>) => {
    const next = saveSettings(patch);
    setSettings(next);
  };

  const sessionRef = useRef<AddyAudioSession | null>(null);

  // Fetch initial recollections from backend database
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/memories", { signal: ctrl.signal })
      .then(res => res.json())
      .then(data => {
        if (!ctrl.signal.aborted && Array.isArray(data)) {
          setMemories(data);
        }
      })
      .catch(err => {
        if (err.name !== "AbortError") {
          console.error("Initial persistent recollections load failure:", err);
        }
      });
    return () => ctrl.abort();
  }, []);

  const handleAddManualMemory = async (category: MemoryCategory, text: string) => {
    try {
      const resp = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, text })
      });
      const saved = await resp.json();
      if (saved && saved.id) {
        setMemories((prev) => [...prev, saved]);
      }
    } catch (err) {
      console.error("Manual database recollect upload error:", err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const resp = await fetch(`/api/memories/${id}`, {
        method: "DELETE"
      });
      const resObj = await resp.json();
      if (resObj && resObj.success) {
        setMemories((prev) => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error("Manual memory delete execution failed:", err);
    }
  };

  // Initialize the audio session handlers once on mount
  useEffect(() => {
    sessionRef.current = new AddyAudioSession({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === "disconnected") {
          setUserCaption("");
          setModelCaption("");
          setActiveEmotion("idle");
          setCharacterState("idle");
        } else if (newState === "listening") {
          // Return to receptive resting state
          setActiveEmotion("idle");
          setCharacterState("idle");
        } else if (newState === "speaking") {
          setCharacterState("talking");
        }
      },
      onTranscription: (role, text) => {
        if (role === "user") {
          setUserCaption(text);
          setModelCaption("");
          setCharacterState("thinking");
          // Push to chat messages
          const id = `msg_${++msgIdCounter.current}`;
          chatMsgIds.current.add(id);
          setChatMessages((prev) => [...prev, { id, role: "user", text, timestamp: Date.now() }]);
          // Stop/interrupt command detection.
          // ONLY "stop listening" puts Addy to sleep (dormant: no listening,
          // no responding, wake word stays armed so her name wakes her).
          // Matched anywhere in the utterance ("just stop listening",
          // "please stop listening now"), so the command works however
          // it's phrased. Everything else flows to Gemini normally.
          const lower = text.toLowerCase().trim();
          if (stateRef.current !== "disconnected" && lower.includes("stop listening")) {
            setWakeForced(true);
            sessionRef.current?.disconnect();
          }
        } else if (role === "model") {
          const cleanChunk = filterToolCallLeakage(text);
          if (!cleanChunk) return;

          setModelCaption((prev) => {
            const next = prev + cleanChunk;
            const newEmotion = detectEmotionFromText(next);
            setActiveEmotion(newEmotion);
            return next;
          });
          // Clear user caption when model replies
          setUserCaption("");
          // Push to chat messages (update the last model message or append)
          setChatMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : null;
            if (last && last.role === "model") {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, text: last.text + cleanChunk };
              return updated;
            }
            const id = `msg_${++msgIdCounter.current}`;
            chatMsgIds.current.add(id);
            return [...prev, { id, role: "model", text: cleanChunk, timestamp: Date.now() }];
          });
        }
      },
      onToolCall: (name, args, callback) => {
        console.log(`[App] Tool call triggered: ${name}`, args);
        
        const browserTools = [
          "browserOpen",
          "browserSearch",
          "browserClick",
          "browserMediaControl",
          "browserScroll",
          "browserType",
          "browserGoBack",
          "browserTabAction",
          "openWebsite"
        ];

        if (browserTools.includes(name)) {
          let url = "";
          if (name === "browserOpen" || name === "openWebsite") {
            url = args.url || "https://google.com";
          } else if (name === "browserSearch") {
            url = `https://google.com/search?q=${encodeURIComponent(args.query || "")}`;
          } else {
            url = args.url || "https://google.com";
          }
          if (!/^https?:\/\//i.test(url)) url = "https://" + url;
          const opened = window.open(url, "_blank");
          if (opened === null && !(window as any).Addy?.isDesktop) {
            setActiveProjectorUrl(url);
          }
          callback({ result: `Opening ${url} in your browser.` });
        } else if (name === "changeBackground") {
          const colorName = args.color?.toLowerCase();
          const validColors = ["violet", "crimson", "emerald", "celestial", "gold", "rose", "charcoal"];
          
          if (colorName && validColors.includes(colorName)) {
            setThemeColor(colorName);
            callback({ result: `Successfully shifted aesthetic atmosphere to ${colorName}.` });
          } else {
            callback({ error: `Unsupported color '${colorName}'. Supported themes are: ${validColors.join(", ")}` });
          }
        } else {
          console.warn(`[App] Unhandled tool call: ${name}`, args);
          callback({ error: `Tool ${name} is not implemented.` });
        }
      },
      onError: (err) => {
        setErrorText(err);
      },
      onMemorySync: (updatedMemories) => {
        console.log("[App] WebSocket memories sync triggered:", updatedMemories);
        if (Array.isArray(updatedMemories)) {
          setMemories(updatedMemories);
        }
      },
      onSessionInit: (sid) => {
        console.log("[App] Voice session initialized:", sid);
        setActiveSessionId(sid);
      },
      onMousePosition: (x, y) => {
        setMousePos({ x, y });
      },
    });

    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  // Keep listening closed by default on startup — Addy starts dormant and wakes up via wake word ("babe"/"addy") or user interaction.

  const handleMicMute = async () => {
    if (isMicMuted) {
      setIsMicMuted(false);
      // Unmute — reconnect the audio session
      if (sessionRef.current && state === "disconnected") {
        await sessionRef.current.connect();
      }
    } else {
      // Mute — disconnect the audio session but keep wake word alive
      setIsMicMuted(true);
      if (sessionRef.current && state !== "disconnected") {
        sessionRef.current.disconnect();
      }
    }
  };

  const handleToggleConnection = async () => {
    setErrorText(null);
    if (!sessionRef.current) return;
    if (state === "disconnected") {
      setIsMicMuted(false);
      setWakeForced(false);
      await sessionRef.current.connect();
      if ((window as any).Addy?.getScreenStream && settings.autoStartScreenShare !== false) {
        setTimeout(() => { startScreenSharing(); }, 800);
      }
    } else {
      // "Sleep core": same dormant semantics as the voice command - the
      // wake word stays armed so her name wakes her.
      setWakeForced(true);
      sessionRef.current.disconnect();
    }
  };
  // V2: keep the ref in sync so the wake-word callback calls this exact handler.
  connectHandlerRef.current = handleToggleConnection;

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isTextChatOpen, setIsTextChatOpen] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const msgIdCounter = useRef(0);
  const chatMsgIds = useRef(new Set<string>());

  // Active session: which session does the text chat show & write to?
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Load ONE session's messages (replaces the old merged-history approach)
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/phasex/sessions/${sessionId}`);
      if (!res.ok) {
        if (res.status === 404) setActiveSessionId(null);
        return;
      }
      const data = await res.json();
      const mapped: ChatMessage[] = (data.messages || []).map((m: any, i: number) => ({
        id: `${sessionId}_${m.id || i}`,
        role: m.role === "Addy" ? "model" : "user",
        text: m.text,
        timestamp: m.timestamp || Date.now(),
      }));
      setChatMessages(mapped);
    } catch { /* best-effort */ }
  }, []);

  // Session list for the text chat rail
  const [sessions, setSessions] = useState<any[]>([]);
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/phasex/sessions?limit=50");
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch { setSessions([]); }
  }, []);
  useEffect(() => { if (isTextChatOpen) refreshSessions(); }, [isTextChatOpen, refreshSessions]);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    loadSessionMessages(id);
  };

  const handleResumeSession = (id: string) => {
    setActiveSessionId(id);
    loadSessionMessages(id);
    setIsTextChatOpen(true);
    setShowSessionManager(false);
  };

  const closeAllPanels = () => {
    setIsTextChatOpen(false);
    setShowMemoryDashboard(false);
    setShowSettings(false);
    setShowDevPanel(false);
    setShowDesktopPanel(false);
    setShowSessionManager(false);
  };

  const anyPanelOpen =
    isTextChatOpen || showMemoryDashboard || showSettings || showDevPanel || showDesktopPanel || showSessionManager;

  // Text-only chat via REST API (no audio)
  const sendTextChat = async (messages: ChatMessage[], userText: string) => {
    const userMsg: ChatMessage = { id: `msg_${++msgIdCounter.current}`, role: "user", text: userText, timestamp: Date.now() };
    chatMsgIds.current.add(userMsg.id);
    const updatedMessages = [...messages, userMsg];
    setChatMessages(updatedMessages);

    const modelId = `msg_${++msgIdCounter.current}`;
    chatMsgIds.current.add(modelId);
    setChatMessages((prev) => [...prev, { id: modelId, role: "model", text: "", timestamp: Date.now() }]);

    try {
      const resp = await fetch("/api/chat/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, text: m.text })),
          sessionId: activeSessionId,
        }),
      });
      
      // Capture session id from response header (first message in a new session)
      const returnedSessionId = resp.headers.get("X-Session-Id");
      if (returnedSessionId && returnedSessionId !== activeSessionId) {
        setActiveSessionId(returnedSessionId);
      }
      
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        setChatMessages((prev) =>
          prev.map((m) => m.id === modelId ? { ...m, text: `Error: ${err.error}` } : m)
        );
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          setChatMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : null;
            if (last && last.id === modelId) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, text: last.text + chunk };
              return updated;
            }
            return prev;
          });
        }
      }
    } catch (e: any) {
      setChatMessages((prev) =>
        prev.map((m) => m.id === modelId ? { ...m, text: `Error: ${e?.message || "Connection failed"}` } : m)
      );
    }
  };

  const handleTextChatSend = (text: string) => {
    if (state !== "disconnected" && sessionRef.current) {
      const id = `msg_${++msgIdCounter.current}`;
      chatMsgIds.current.add(id);
      setChatMessages((prev) => [...prev, { id, role: "user", text, timestamp: Date.now() }]);
      sessionRef.current.sendText(text);
      return;
    }
    sendTextChat(chatMessages, text);
  };

  const handleTextChatRegenerate = () => {
    let userText = "";
    let remaining: ChatMessage[] = [];
    setChatMessages((prev) => {
      const revIdx = [...prev].reverse().findIndex((m) => m.role === "user");
      if (revIdx === -1) return prev;
      const userMsg = [...prev].reverse()[revIdx];
      userText = userMsg.text;
      remaining = prev.slice(0, prev.length - revIdx);
      return remaining;
    });
    if (userText) {
      sendTextChat(remaining, userText);
    }
  };

  const handleTextChatEdit = (id: string, newText: string) => {
    let remaining: ChatMessage[] = [];
    setChatMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) return prev;
      remaining = prev.slice(0, idx);
      return remaining;
    });
    sendTextChat(remaining, newText);
  };

  const handleNewSession = () => {
    setChatMessages([]);
    msgIdCounter.current = 0;
    chatMsgIds.current.clear();
    setActiveSessionId(null);
  };

  // Restore the last active session across reloads so we continue, not restart
  useEffect(() => {
    const saved = localStorage.getItem("addy.activeSessionId");
    if (saved) {
      setActiveSessionId(saved);
      loadSessionMessages(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the active session id so a reload picks up where we left off
  useEffect(() => {
    if (activeSessionId) localStorage.setItem("addy.activeSessionId", activeSessionId);
    else localStorage.removeItem("addy.activeSessionId");
  }, [activeSessionId]);

  // Keepalive: ping the server every 30s to keep the event loop warm and
  // trigger the desktop agent watchdog.
  useEffect(() => {
    const ping = () => { fetch("/api/ping").catch(() => {}); };
    ping();
    const iv = setInterval(ping, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Maps theme colors to CSS ambient light spots
  const getAmbientStyles = () => {
    switch (themeColor) {
      case "violet":
        return "from-purple-950/40 via-violet-950/20 to-slate-950";
      case "crimson":
        return "from-red-950/40 via-orange-950/20 to-slate-950";
      case "emerald":
        return "from-emerald-950/40 via-teal-950/20 to-slate-950";
      case "celestial":
        return "from-sky-950/45 via-indigo-950/25 to-slate-950";
      case "gold":
        return "from-amber-950/30 via-yellow-950/15 to-slate-950";
      case "rose":
        return "from-rose-950/40 via-pink-950/20 to-slate-950";
      case "charcoal":
      default:
        return "from-slate-900/50 via-slate-950/30 to-slate-950";
    }
  };

  const getThemeTextGlow = () => {
    switch (themeColor) {
      case "violet": return "text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]";
      case "crimson": return "text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "emerald": return "text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]";
      case "celestial": return "text-sky-400 drop-shadow-[0_0_12px_rgba(14,165,233,0.5)]";
      case "gold": return "text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]";
      case "rose": return "text-pink-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "charcoal":
      default:
        return "text-indigo-400 drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]";
    }
  };

  const getOrbRingColor = () => {
    switch (state) {
      case "listening": return "border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.3)] bg-indigo-500/10";
      case "speaking": return "border-purple-500/70 shadow-[0_0_40px_rgba(168,85,247,0.4)] bg-purple-500/10";
      case "connecting": return "border-amber-500/50 animate-pulse bg-amber-500/10";
      case "disconnected":
      default:
        return "border-white/10 hover:border-indigo-500/30 bg-white/5";
    }
  };

  return (
    <div
      id="Addy-holographic-desktop"
      className={`relative w-full h-screen overflow-hidden bg-[#020205] text-white ${getAmbientStyles()} theme-transition select-none`}
    >
      {/* Ambient Background Gradients matching Frosted Glass theme */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-cyan-900/15 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] bg-indigo-800/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Decorative grid pattern background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />

      {/* FULL VIEWPORT HOLOGRAPHIC STAGE: Addy materializes across the entire screen */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none">
        <AddyCoreVisualizer
          session={sessionRef.current}
          state={state}
          themeColor={themeColor}
          activeEmotion={activeEmotion}
          characterState={characterState}
        />
      </div>

      {/* Content wrapper — scales when side panels are open */}
      <motion.div
        className="relative z-10 flex flex-col justify-between h-full p-6 sm:p-10"
        animate={{
          x: isTextChatOpen || showMemoryDashboard || showSettings || showDevPanel || showDesktopPanel ? -180 : 0,
        }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
      >
      {/* FUTURISTIC COMMAND HUD & FLOATING NAVIGATION ISLAND */}
      <header className="relative flex flex-wrap items-center justify-between gap-4 w-full max-w-6xl mx-auto select-none shrink-0 z-30 pt-2">
        {/* Brand & Core Status */}
        <div className="flex items-center gap-3 glass-pill px-4 py-2 rounded-2xl border border-white/10 shadow-lg">
          <div className="relative flex items-center justify-center">
            <div className={`w-2.5 h-2.5 rounded-full ${
              state === "listening" || state === "speaking" 
                ? "bg-cyan-400 animate-ping" 
                : state === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-purple-400"
            }`} />
            <div className={`absolute w-2.5 h-2.5 rounded-full ${
              state === "listening" || state === "speaking" 
                ? "bg-cyan-400" 
                : state === "connecting"
                ? "bg-amber-400"
                : "bg-purple-500"
            }`} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-[0.25em] text-white uppercase font-display">
                ADDY AI
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 font-mono font-medium">
                v3.0
              </span>
            </div>
            <span className="text-[9px] font-mono text-white/40 tracking-wider">
              {state === "speaking" ? "TRANSCEIVING SPEECH" : state === "listening" ? "ACTIVE LISTENING" : "HOLOGRAPHIC STANDBY"}
            </span>
          </div>
        </div>

        {/* Floating Glass Navigation Dock */}
        <nav className="flex items-center gap-1.5 glass-panel px-3 py-1.5 rounded-2xl border border-white/10 shadow-2xl">
          <button
            onClick={() => setIsTextChatOpen(!isTextChatOpen)}
            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              isTextChatOpen
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title="Chat & Terminal"
          >
            <MessageSquare size={14} />
            <span className="hidden sm:inline">CHAT</span>
          </button>

          <button
            onClick={() => setShowMemoryDashboard(!showMemoryDashboard)}
            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              showMemoryDashboard
                ? "bg-purple-500/20 text-purple-300 border border-purple-400/40 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title="Recollections & Memory Matrix"
          >
            <Brain size={14} />
            <span className="hidden sm:inline">MEMORY</span>
          </button>

          <button
            onClick={() => setShowDesktopPanel(!showDesktopPanel)}
            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              showDesktopPanel
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/40 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title="Desktop Automation & OS Radar"
          >
            <Compass size={14} />
            <span className="hidden sm:inline">DESKTOP</span>
          </button>

          <button
            onClick={() => setShowDevPanel(!showDevPanel)}
            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              showDevPanel
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title="Developer CLI & MCP Tools"
          >
            <Terminal size={14} />
            <span className="hidden sm:inline">DEV</span>
          </button>

          <button
            onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              isScreenSharing
                ? "bg-cyan-500/25 text-cyan-200 border border-cyan-400/60 animate-pulse"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title="Screen Vision & Video Stream"
          >
            <Monitor size={14} />
            <span className="hidden sm:inline">{isScreenSharing ? "VISION ON" : "VISION"}</span>
          </button>

          <button
            onClick={() => setShowSessionManager(!showSessionManager)}
            className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              showSessionManager
                ? "bg-white/20 text-white border border-white/30"
                : "text-white/50 hover:text-white hover:bg-white/5"
            }`}
            title="Session History"
          >
            <Clock size={14} />
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-mono font-medium transition-all duration-200 cursor-pointer ${
              showSettings
                ? "bg-white/20 text-white border border-white/30"
                : "text-white/50 hover:text-white hover:bg-white/5"
            }`}
            title="Settings & Persona Configuration"
          >
            <SettingsIcon size={14} className={showSettings ? "animate-spin [animation-duration:6s]" : ""} />
          </button>
        </nav>

        {/* Live System Telemetry Badges */}
        <div className="hidden lg:flex items-center gap-2 font-mono text-[10px]">
          <div className="glass-pill px-3 py-1.5 rounded-xl flex items-center gap-2 border border-purple-500/20 bg-purple-950/20 text-purple-300">
            <Mic size={11} className="text-purple-400" />
            <span>WAKE: BABE / ADDY</span>
          </div>

          <div className="glass-pill px-3 py-1.5 rounded-xl flex items-center gap-2 border border-emerald-500/20 bg-emerald-950/20 text-emerald-300">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>EDGE BROWSER 2.0</span>
          </div>

          <div className="glass-pill px-3 py-1.5 rounded-xl flex items-center gap-2 border border-cyan-500/20 bg-cyan-950/20 text-cyan-300">
            <Radio size={11} className="animate-pulse" />
            <span>AGENT :8765</span>
          </div>
        </div>
      </header>

      {/* CORE AVATAR AND VISUALS */}
      <main className="relative z-10 flex-1 w-full max-w-4xl mx-auto flex flex-col items-center justify-between py-6">
        
        {/* Browser Link notification — opens in user's default browser */}
        <AnimatePresence>
          {activeProjectorUrl && (
            <div className="absolute inset-x-0 top-0 z-30 flex justify-center p-2">
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-indigo-500/20 bg-indigo-950/45 backdrop-blur-xl shadow-lg w-full max-w-md"
              >
                <div className="flex items-center gap-3 overflow-hidden text-left">
                  <div className="p-2 ml-1 rounded-xl bg-indigo-500/20 text-indigo-300">
                    <Globe size={18} />
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="text-xs font-bold font-mono tracking-wide text-indigo-200 uppercase">Open in Browser</h4>
                    <p className="text-xs text-indigo-400 truncate max-w-[200px]">{activeProjectorUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { window.open(activeProjectorUrl, "_blank"); setActiveProjectorUrl(null); }}
                    className="p-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-400 transition flex items-center gap-1"
                    title="Open in your default browser"
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    onClick={() => setActiveProjectorUrl(null)}
                    className="p-2 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Space Spacer to avoid head area */}
        <div className="h-10 sm:h-20" />

        {/* Cinematic dialogue layer overlay - Addy's voice shown here */}
        <div id="cinematic-subtitles" className="w-full max-w-3xl flex flex-col items-center justify-center text-center px-6 relative z-25 mt-auto mb-6 pointer-events-none min-h-[6rem]">
          <AnimatePresence mode="wait">
            {(() => {
              const activeText = modelCaption 
                ? modelCaption 
                : state === "speaking"
                  ? ""
                  : state === "listening" 
                    ? "I am listening. Speak freely..." 
                    : state === "connecting" 
                      ? "Materializing presence links..." 
                      : "";

              return activeText ? (
                <motion.div
                  key={modelCaption ? "model" : "status"}
                  initial={{ opacity: 0, y: 15, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -15, filter: "blur(6px)" }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center justify-center w-full"
                >
                  {modelCaption ? (
                    <h2 className="text-xl sm:text-2xl font-light text-white leading-relaxed tracking-wide font-display max-w-2xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)]">
                      {activeText}
                    </h2>
                  ) : (
                    <span className="text-xs sm:text-sm uppercase tracking-[0.3em] font-medium text-white/30 font-sans tracking-widest drop-shadow-[0_1px_4px_rgba(0, 0, 0, 0.5)]">
                      {activeText}
                    </span>
                  )}
                </motion.div>
              ) : null;
            })()}
          </AnimatePresence>
        </div>



        {/* Global Error Banner */}
        <AnimatePresence>
          {errorText && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="mt-6 flex items-start gap-3 p-4 rounded-2xl border border-rose-500/20 bg-rose-950/40 backdrop-blur-xl max-w-md w-full text-left"
            >
              <CircleAlert className="text-rose-400 shrink-0 mt-0.5" size={18} />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-rose-300 font-mono">Core Error Protocol</h4>
                <p className="text-xs text-rose-200 mt-1 leading-relaxed">{errorText}</p>
                <button
                  onClick={() => setErrorText(null)}
                  className="mt-2 text-[10px] font-bold text-rose-400 underline font-mono uppercase"
                >
                  Dismiss Code
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* FOOTER INTERFACE WITH WAVEFORM AND CONTROLS */}
      <footer className="relative z-10 w-full max-w-2xl mx-auto flex flex-col items-center gap-5 mt-auto">
        
        {/* Text input removed — use the TEXT CHAT panel for typing */}

        {/* Dynamic Minimalist Waveform Visualizer */}
        <div className="flex items-center justify-center gap-1 h-8 w-44">
          {[12, 28, 16, 32, 20, 8].map((baseHeight, idx) => {
            let heightFactor = 0.35;
            if (state === "speaking") {
              heightFactor = 0.35 + Math.sin(Date.now() * 0.02 + idx * 0.9) * 0.65;
            } else if (state === "listening") {
              heightFactor = 0.2 + Math.sin(Date.now() * 0.01 + idx * 0.5) * 0.4;
            } else {
              heightFactor = idx % 2 === 0 ? 0.25 : 0.12;
            }
            const calculatedHeight = Math.max(3, baseHeight * heightFactor);

            return (
              <div
                key={idx}
                className={`w-0.5 rounded-full transition-all duration-300 ${
                  state === "speaking" ? "bg-purple-400" : state === "listening" ? "bg-cyan-400" : "bg-white/10"
                }`}
                style={{ height: `${calculatedHeight}px` }}
              />
            );
          })}
        </div>

        {/* Glossy Beautiful Primary Connector Core Node */}
        <div className="flex items-center justify-center relative mb-4 gap-3">
          {/* Mic mute button */}
          {(state !== "disconnected" || isMicMuted) && (
            <button 
              onClick={handleMicMute}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer ${
                isMicMuted
                  ? "bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25"
                  : "bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
              }`}
              title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <MicOff size={14} />
            </button>
          )}

          <button 
            onClick={handleToggleConnection}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer ${
              state === "disconnected"
                ? "bg-white/10 hover:bg-white/15 border border-white/15 text-white shadow-[0_0_20px_rgba(255,255,255,0.02)] hover:scale-105 active:scale-95"
                : state === "listening"
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/80 text-cyan-200 shadow-[0_0_35px_rgba(34,211,238,0.3)] animate-pulse scale-105"
                : state === "speaking"
                ? "bg-purple-500/90 hover:bg-purple-600 border border-purple-400/95 text-white shadow-[0_0_35px_rgba(168,85,247,0.4)] scale-105"
                : "bg-amber-600 border border-amber-300 text-white animate-spin"
            }`}
            title={state === "disconnected" ? "Awake Addy" : "Sleep core"}
          >
            {state === "disconnected" ? (
              <Power className="opacity-80" size={24} />
            ) : state === "connecting" ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : state === "listening" ? (
              <Mic size={24} className="text-cyan-200" />
            ) : (
              <Volume2 size={24} className="text-white" />
            )}
          </button>

          {/* Clear notifications */}
          {(activeProjectorUrl || errorText) && (
            <button 
              onClick={() => {
                setActiveProjectorUrl(null);
                setErrorText(null);
              }}
              className="absolute right-[-60px] p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition duration-150 cursor-pointer"
              title="Clear notifications"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Wake word arming indicator */}
        <div className="mt-1 text-[10px] tracking-widest uppercase font-medium text-white/35">
          wake: <span className={
            wakeState === "listening" ? "text-emerald-400" :
            wakeState === "triggered" ? "text-purple-300" :
            wakeState === "error" ? "text-rose-400" : "text-white/25"
          }>{wakeState}</span>
        </div>

      </footer>
      </motion.div>

      {/* Dynamic Floating Glassmorphic Screen Sharing Control Hub */}
      <AnimatePresence>
        {isScreenSharing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, x: 50 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: 50 }}
            className={`absolute bottom-6 md:bottom-10 right-6 md:right-10 z-50 w-72 p-4 rounded-2xl border ${
              isScreenSharingPaused 
                ? "border-amber-500/20 bg-slate-950/70" 
                : "border-cyan-500/20 bg-slate-950/70"
            } backdrop-blur-2xl shadow-2xl overflow-hidden`}
          >
            {/* Header / Indicator */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isScreenSharingPaused ? "bg-amber-400" : "bg-cyan-400 animate-pulse"}`} />
                <span className="text-[10px] font-bold font-mono tracking-widest text-slate-200">
                  {isScreenSharingPaused ? "SCREEN VISION PAUSED" : "SCREEN VISION ACTIVE"}
                </span>
              </div>
              <button 
                onClick={stopScreenSharing}
                className="text-slate-400 hover:text-white transition-colors duration-150 p-1 rounded-lg hover:bg-white/5 cursor-pointer"
                title="Stop Sharing"
              >
                <X size={14} />
              </button>
            </div>

            {/* Smart Video PIP Preview Holder */}
            <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-900 border border-white/5 mb-3 flex items-center justify-center group select-none">
              <video
                ref={(el) => {
                  if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                    el.srcObject = screenStreamRef.current;
                    el.muted = true;
                    el.play().catch(err => console.log("Mini preview stream play issue:", err));
                  }
                }}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isScreenSharingPaused ? "opacity-30 blur-sm" : "opacity-90"
                }`}
                autoPlay
                playsInline
                muted
              />

              {isScreenSharingPaused && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] uppercase tracking-widest font-mono text-amber-400 font-bold px-2 py-1 bg-amber-950/40 border border-amber-500/20 rounded-md">
                    Transmission Paused
                  </span>
                </div>
              )}
              
              {!isScreenSharingPaused && screenVisionMode && (
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-400/20 text-[9px] font-mono text-cyan-300">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
                  <span>Streaming FPS: 0.5</span>
                </div>
              )}
            </div>

            {/* Quick Action Control Strip */}
            <div className="flex items-center justify-between gap-1.5 mb-2.5">
              {isScreenSharingPaused ? (
                <button
                  onClick={resumeScreenSharing}
                  className="flex-1 py-1.5 px-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-lg text-xs font-mono font-medium text-cyan-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Resume Streaming Feed"
                >
                  <Play size={10} />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  onClick={pauseScreenSharing}
                  className="flex-1 py-1.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-xs font-mono font-medium text-amber-300 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Pause Streaming Feed"
                >
                  <Pause size={10} />
                  <span>Pause</span>
                </button>
              )}

              <button
                onClick={switchScreenShare}
                className="py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white flex items-center justify-center gap-1 transition-all cursor-pointer"
                title="Choose Another Screen or Window"
              >
                <RefreshCw size={11} />
                <span>Switch</span>
              </button>

              <button
                onClick={stopScreenSharing}
                className="py-1.5 px-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-xs font-mono text-rose-400 flex items-center justify-center gap-1 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                title="Terminate Stream"
              >
                <Square size={9} />
                <span>Stop</span>
              </button>
            </div>

            {/* Core Mode Configuration Toggle */}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-left">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold font-mono text-slate-200">SCREEN VISION MODE</span>
                <span className="text-[8px] text-slate-400 uppercase font-mono max-w-[150px]">Gemini Auto-Analysis</span>
              </div>
              <button
                onClick={() => setScreenVisionMode(!screenVisionMode)}
                className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none cursor-pointer ${
                  screenVisionMode ? "bg-cyan-500" : "bg-white/10"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ease-in-out ${
                    screenVisionMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click-outside-to-collapse backdrop (sits below drawers, above app content) */}
      {anyPanelOpen && (
        <div
          className="fixed inset-0 z-40 bg-transparent cursor-default"
          onClick={closeAllPanels}
          title="Click outside to close"
        />
      )}

      {/* Recollections sliding core panel */}
      <MemoryDashboard
        isOpen={showMemoryDashboard}
        onClose={() => setShowMemoryDashboard(false)}
        memories={memories}
        onAddMemory={handleAddManualMemory}
        onDeleteMemory={handleDeleteMemory}
        themeColor={themeColor}
      />

      {/* V2: Settings sliding core panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onChange={handleSettingsChange}
        themeColor={themeColor}
      />

      {/* Dev Tools sliding panel */}
      <DevPanel
        isOpen={showDevPanel}
        onClose={() => setShowDevPanel(false)}
        themeColor={themeColor}
      />

      {/* Session Manager Panel */}
      <SessionManagerPanel
        isOpen={showSessionManager}
        onClose={() => setShowSessionManager(false)}
        themeColor={themeColor}
        onResumeSession={handleResumeSession}
      />

      {/* Desktop Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-80 max-w-[90vw] z-50 transition-transform duration-300 ease-out ${
          showDesktopPanel ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <DesktopPanel />
      </div>

      {/* Text Chat Panel */}
      <TextChatPanel
        isOpen={isTextChatOpen}
        onClose={() => setIsTextChatOpen(false)}
        messages={chatMessages}
        onSend={handleTextChatSend}
        onRegenerate={handleTextChatRegenerate}
        onEditMessage={handleTextChatEdit}
        onNewSession={handleNewSession}
        isStreaming={state === "speaking"}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onRefreshSessions={refreshSessions}
      />
      {mousePos && (
        <div className="fixed bottom-4 left-4 z-40 bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 font-mono text-[11px] text-white/50 pointer-events-none select-none backdrop-blur-sm">
          <span className="text-white/30">cursor</span>{" "}
          <span className="text-cyan-400">{mousePos.x}</span>
          <span className="text-white/30">,</span>{" "}
          <span className="text-cyan-400">{mousePos.y}</span>
        </div>
      )}
    </div>
  );
}
