import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AddyAudioSession, LiveState } from "../lib/audio";
import type { AddyEmotion } from "./AddyCoreVisualizer";
import { Sparkles, Maximize2, Minimize2, RefreshCw } from "lucide-react";

interface Addy3DAvatarProps {
  session: AddyAudioSession | null;
  state: LiveState;
  themeColor: string;
  activeEmotion?: AddyEmotion;
  characterState: "idle" | "thinking" | "talking";
  className?: string;
  cameraView?: "bust" | "full";
  onFallbackToOrb?: () => void;
}

const MODEL_PATH = "/models/addy.glb";

export const Addy3DAvatar: React.FC<Addy3DAvatarProps> = ({
  session,
  state,
  themeColor,
  activeEmotion = "idle",
  characterState,
  className = "",
  cameraView: initialCameraView = "bust",
  onFallbackToOrb,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cameraView, setCameraView] = useState<"bust" | "full">(initialCameraView);

  // Animation & Rendering refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);
  const faceMeshRef = useRef<THREE.Mesh | null>(null);
  const haloMeshRef = useRef<THREE.Object3D | null>(null);
  const companionMeshRef = useRef<THREE.Object3D | null>(null);
  const cyanEmissivesRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const purpleEmissivesRef = useRef<THREE.MeshStandardMaterial[]>([]);

  // Real-time tracking & states
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const targetMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const characterStateRef = useRef(characterState);
  const activeEmotionRef = useRef(activeEmotion);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);

  useEffect(() => { characterStateRef.current = characterState; }, [characterState]);
  useEffect(() => { activeEmotionRef.current = activeEmotion; }, [activeEmotion]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Handle camera view change
  const setCameraFraming = useCallback((view: "bust" | "full") => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (view === "bust") {
      // Cinematic upper-torso and face framing
      camera.position.set(0, 1.35, 1.30);
      camera.lookAt(0, 1.26, 0);
    } else {
      // Full body framing
      camera.position.set(0, 0.95, 2.65);
      camera.lookAt(0, 0.85, 0);
    }
  }, []);

  useEffect(() => {
    setCameraFraming(cameraView);
  }, [cameraView, setCameraFraming]);

  // Window mouse move listener for smooth head/eye tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetMouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Main Three.js setup & render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDisposed = false;
    let animFrameId: number;

    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 800;

    // 1. WebGL Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (err: any) {
      console.warn("[Addy3DAvatar] WebGLRenderer creation failed:", err);
      setLoadError(err?.message || "WebGL initialization failed");
      setIsLoading(false);
      return;
    }
    rendererRef.current = renderer;
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // 2. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 3. Camera
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    cameraRef.current = camera;
    setCameraFraming(cameraView);

    // 4. Balanced Studio Lighting for Anime Lookdev
    const ambientLight = new THREE.AmbientLight(0xdce7f5, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(0.6, 2.2, 1.8);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5b4fc, 0.65);
    fillLight.position.set(-0.8, 1.6, 1.0);
    scene.add(fillLight);

    // Cyan rim light (ADDY's signature cyan highlight)
    const cyanRim = new THREE.DirectionalLight(0x00e5ff, 1.8);
    cyanRim.position.set(-1.4, 1.8, -1.0);
    scene.add(cyanRim);

    // Violet rim light (ADDY's signature purple highlight)
    const purpleRim = new THREE.DirectionalLight(0xa855f7, 1.5);
    purpleRim.position.set(1.4, 1.6, -1.0);
    scene.add(purpleRim);

    // 5. Load ADDY GLB Model
    const loader = new GLTFLoader();
    setIsLoading(true);

    loader.load(
      MODEL_PATH,
      (gltf) => {
        if (isDisposed) return;
        const model = gltf.scene;
        modelRootRef.current = model;

        cyanEmissivesRef.current = [];
        purpleEmissivesRef.current = [];

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;

            // Find face mesh for facial morph targets
            if (mesh.name.toLowerCase().includes("face") && mesh.morphTargetInfluences) {
              faceMeshRef.current = mesh;
            }

            // Find cyber props
            if (mesh.name.includes("Prop_Halo")) {
              haloMeshRef.current = mesh;
            }
            if (mesh.name.includes("Prop_Companion")) {
              companionMeshRef.current = mesh;
            }

            // Anime material calibrations
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.roughness = Math.max(0.3, mat.roughness ?? 0.5);

                if (
                  mat.name.includes("Emission_Cyan") ||
                  mat.name.includes("Light") ||
                  mesh.name.includes("HairClip") ||
                  mesh.name.includes("Pendant")
                ) {
                  mat.emissive = new THREE.Color(0x00e5ff);
                  mat.emissiveIntensity = 1.4;
                  cyanEmissivesRef.current.push(mat);
                } else if (mat.name.includes("Emission_Purple") || mat.name.includes("Halo")) {
                  mat.emissive = new THREE.Color(0xa855f7);
                  mat.emissiveIntensity = 1.2;
                  purpleEmissivesRef.current.push(mat);
                } else if (mat.name.includes("Skin")) {
                  mat.color = new THREE.Color(0xf8e8e3);
                  mat.roughness = 0.85;
                } else if (mat.name.includes("Cyber_White") || mat.name.includes("Jacket")) {
                  mat.color = new THREE.Color(0xf5f5fa);
                } else if (mat.name.includes("Obsidian") || mat.name.includes("Inner")) {
                  mat.color = new THREE.Color(0x12141a);
                }
              }
            });
          }
        });

        model.position.set(0, 0, 0);
        scene.add(model);
        setIsLoading(false);
      },
      undefined,
      (err) => {
        if (isDisposed) return;
        console.error("[Addy3DAvatar] Error loading model:", err);
        setLoadError("Could not load ADDY 3D model asset.");
        setIsLoading(false);
      }
    );

    // 6. Animation State Variables
    let lastTime = performance.now();
    let clockTime = 0;
    let autoBlinkTimer = 0;
    let isBlinking = false;
    let blinkProgress = 0;
    let smoothedMouth = 0;
    let smoothedSmile = 0;
    let smoothedHeadRot = { x: 0, y: 0, z: 0 };

    const audioBuffer = new Uint8Array(64);

    // 7. Render Loop
    const animate = (currentTime: number) => {
      animFrameId = requestAnimationFrame(animate);

      const dt = Math.min(0.1, (currentTime - lastTime) / 1000);
      lastTime = currentTime;
      clockTime += dt;

      // Mouse tracking interpolation
      mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * Math.min(1, dt * 8);
      mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * Math.min(1, dt * 8);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // --- Breathing Motion ---
      const breath = Math.sin(clockTime * 2.2) * 0.003;
      const sway = Math.sin(clockTime * 0.9) * 0.012;

      // --- Head & Body Tracking ---
      let targetRotY = mx * 0.22 + sway;
      let targetRotX = -my * 0.15;
      let targetRotZ = -mx * 0.05;

      // Emotion / State adjustments to posture
      const currentEmotion = activeEmotionRef.current;
      const charState = characterStateRef.current;

      if (charState === "thinking") {
        targetRotX -= 0.12; // tilted slightly upward
        targetRotY += 0.08;
      } else if (currentEmotion === "curious") {
        targetRotZ += 0.08; // cute curious head tilt
      } else if (currentEmotion === "embarrassed" || currentEmotion === "sad") {
        targetRotX += 0.14; // tilted down shyly
      }

      smoothedHeadRot.x += (targetRotX - smoothedHeadRot.x) * Math.min(1, dt * 8);
      smoothedHeadRot.y += (targetRotY - smoothedHeadRot.y) * Math.min(1, dt * 8);
      smoothedHeadRot.z += (targetRotZ - smoothedHeadRot.z) * Math.min(1, dt * 8);

      if (modelRootRef.current) {
        modelRootRef.current.position.y = breath;
        modelRootRef.current.rotation.x = smoothedHeadRot.x;
        modelRootRef.current.rotation.y = smoothedHeadRot.y;
        modelRootRef.current.rotation.z = smoothedHeadRot.z;
      }

      // --- Organic Autonomous Blinking ---
      autoBlinkTimer += dt;
      if (!isBlinking && autoBlinkTimer > 3.6 + Math.random() * 2.5) {
        isBlinking = true;
        autoBlinkTimer = 0;
        blinkProgress = 0;
      }

      let blinkVal = 0;
      if (isBlinking) {
        blinkProgress += dt * 6.5; // ~150ms blink
        if (blinkProgress <= 0.5) {
          blinkVal = blinkProgress * 2;
        } else if (blinkProgress < 1.0) {
          blinkVal = 2 - blinkProgress * 2;
        } else {
          blinkVal = 0;
          isBlinking = false;
        }
      }

      // --- Real-time Audio Lip-Sync (FFT Analysis) ---
      let targetMouth = 0;
      const sess = sessionRef.current;
      const st = stateRef.current;

      if (st === "speaking" && sess?.outputAnalyser) {
        try {
          sess.outputAnalyser.getByteFrequencyData(audioBuffer);
          let sum = 0;
          // Sample vocal frequency range
          for (let i = 2; i < 28; i++) {
            sum += audioBuffer[i];
          }
          const avg = sum / 26; // 0 to 255
          targetMouth = Math.min(1, Math.max(0, (avg - 15) / 95));
        } catch (e) {}
      } else if (charState === "talking") {
        // Procedural talking mouth movement fallback
        targetMouth = Math.max(0, Math.sin(clockTime * 12) * 0.45 + Math.sin(clockTime * 8) * 0.25);
      }

      smoothedMouth += (targetMouth - smoothedMouth) * Math.min(1, dt * 20);

      // --- Emotion Blendshapes ---
      let targetSmile = 0;
      if (currentEmotion === "happy" || currentEmotion === "excited" || currentEmotion === "playful") {
        targetSmile = 0.85;
      } else if (currentEmotion === "proud") {
        targetSmile = 0.45;
      }
      smoothedSmile += (targetSmile - smoothedSmile) * Math.min(1, dt * 6);

      // --- Apply Morph Targets to Face Mesh ---
      if (faceMeshRef.current && faceMeshRef.current.morphTargetInfluences) {
        const inf = faceMeshRef.current.morphTargetInfluences;

        // target_36: Both eyes blink
        if (inf[36] !== undefined) inf[36] = blinkVal;

        // target_3: Mouth open (A / lip sync)
        if (inf[3] !== undefined) inf[3] = smoothedMouth;

        // target_4: Mouth wide (I viseme)
        if (inf[4] !== undefined) inf[4] = smoothedMouth * 0.35;

        // target_2: Smile / Joy
        if (inf[2] !== undefined) inf[2] = smoothedSmile;

        // target_44: Surprise expression
        if (currentEmotion === "surprised" && inf[44] !== undefined) {
          inf[44] = 0.6;
        }
      }

      // --- Floating Props Animation ---
      if (haloMeshRef.current) {
        haloMeshRef.current.rotation.y = clockTime * 0.5;
        haloMeshRef.current.position.y = 1.68 + Math.sin(clockTime * 1.8) * 0.02;
      }
      if (companionMeshRef.current) {
        companionMeshRef.current.position.y = 1.45 + Math.cos(clockTime * 1.5) * 0.03;
        companionMeshRef.current.rotation.y = clockTime * 0.8;
      }

      // --- Dynamic Emissive Pulse with Voice ---
      const pulse = 1.0 + smoothedMouth * 0.6;
      cyanEmissivesRef.current.forEach((mat) => {
        mat.emissiveIntensity = 1.3 * pulse;
      });

      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(animate);

    // Resize handler
    const handleResize = () => {
      if (!canvas || !renderer || !camera) return;
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 800;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      isDisposed = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      try {
        renderer?.dispose();
        renderer?.forceContextLoss();
        scene?.clear();
      } catch {}
    };
  }, [cameraView, setCameraFraming]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className}`}
    >
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
        style={{ pointerEvents: "auto" }}
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-20 pointer-events-none">
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 shadow-2xl">
            <RefreshCw className="animate-spin text-cyan-400" size={20} />
            <span className="font-mono text-xs tracking-widest uppercase">
              Materializing ADDY 3D Anime Mesh...
            </span>
          </div>
        </div>
      )}

      {/* Error Fallback */}
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md z-20 p-4">
          <div className="max-w-md p-6 rounded-2xl bg-rose-950/50 border border-rose-500/30 text-rose-200 text-center font-mono text-xs">
            <p className="font-bold uppercase tracking-wider mb-2">3D Render Notice</p>
            <p className="mb-4 text-rose-300/90">{loadError}</p>
            {onFallbackToOrb && (
              <button
                onClick={onFallbackToOrb}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold cursor-pointer transition shadow-lg inline-flex items-center gap-2"
              >
                <Sparkles size={14} />
                <span>Switch to Holographic Orb</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating 3D HUD Controls (View framing switch & info) */}
      <div className="absolute bottom-6 right-6 z-30 flex items-center gap-2">
        <button
          onClick={() => setCameraView(cameraView === "bust" ? "full" : "bust")}
          className="glass-pill px-3 py-1.5 rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-white/70 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1.5 transition-all shadow-lg cursor-pointer"
          title={cameraView === "bust" ? "Switch to Full Body" : "Switch to Close-up Framing"}
        >
          {cameraView === "bust" ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          <span>{cameraView === "bust" ? "FULL VIEW" : "PORTRAIT"}</span>
        </button>

        <div className="glass-pill px-3 py-1.5 rounded-xl border border-cyan-500/20 bg-cyan-950/30 text-cyan-300/80 font-mono text-[11px] flex items-center gap-1.5 shadow-lg">
          <Sparkles size={12} className="text-cyan-400" />
          <span>REAL-TIME 3D</span>
        </div>
      </div>
    </div>
  );
};
