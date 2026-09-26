import React, { useEffect, useRef } from "react";
import { AddyAudioSession, LiveState } from "../lib/audio";
import { AddyEmotion } from "./AddyCoreVisualizer";

export interface ReactingOrbProps {
  session: AddyAudioSession | null;
  state: LiveState;
  themeColor: string;
  activeEmotion?: AddyEmotion;
  characterState: "idle" | "thinking" | "talking";
}

export const ReactingOrb: React.FC<ReactingOrbProps> = ({
  session,
  state,
  themeColor,
  activeEmotion = "idle",
  characterState,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const targetMouseRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const speechVolumeRef = useRef<number>(0);
  const pulsePhaseRef = useRef<number>(0);
  const ringRotationRef = useRef<number>(0);

  // Particles swirling around the orb
  const particlesRef = useRef<
    Array<{
      angle: number;
      radius: number;
      speed: number;
      size: number;
      opacity: number;
      z: number;
    }>
  >([]);

  // Soundwave ripples radiating outward during speech/listening
  const ripplesRef = useRef<
    Array<{
      radius: number;
      maxRadius: number;
      opacity: number;
      speed: number;
    }>
  >([]);

  // Cursor tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetMouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Theme color palette generator
  const getPalette = () => {
    switch (themeColor) {
      case "violet":
        return {
          core: "rgba(238, 210, 255, 1)",
          primary: "rgba(168, 85, 247, 1)",
          secondary: "rgba(192, 38, 211, 0.8)",
          glow: "rgba(147, 51, 234, 0.5)",
          particle: "rgba(216, 180, 254, 0.8)",
        };
      case "crimson":
        return {
          core: "rgba(255, 228, 230, 1)",
          primary: "rgba(244, 63, 94, 1)",
          secondary: "rgba(225, 29, 72, 0.8)",
          glow: "rgba(244, 63, 94, 0.5)",
          particle: "rgba(253, 164, 175, 0.8)",
        };
      case "emerald":
        return {
          core: "rgba(209, 250, 229, 1)",
          primary: "rgba(16, 185, 129, 1)",
          secondary: "rgba(5, 150, 105, 0.8)",
          glow: "rgba(16, 185, 129, 0.5)",
          particle: "rgba(110, 231, 183, 0.8)",
        };
      case "celestial":
        return {
          core: "rgba(224, 242, 254, 1)",
          primary: "rgba(14, 165, 233, 1)",
          secondary: "rgba(2, 132, 199, 0.8)",
          glow: "rgba(14, 165, 233, 0.5)",
          particle: "rgba(125, 211, 252, 0.8)",
        };
      case "gold":
        return {
          core: "rgba(254, 243, 199, 1)",
          primary: "rgba(234, 179, 8, 1)",
          secondary: "rgba(202, 138, 4, 0.8)",
          glow: "rgba(234, 179, 8, 0.5)",
          particle: "rgba(253, 224, 71, 0.8)",
        };
      case "rose":
        return {
          core: "rgba(253, 242, 248, 1)",
          primary: "rgba(236, 72, 153, 1)",
          secondary: "rgba(219, 39, 119, 0.8)",
          glow: "rgba(236, 72, 153, 0.5)",
          particle: "rgba(249, 168, 212, 0.8)",
        };
      case "charcoal":
      default:
        return {
          core: "rgba(224, 247, 250, 1)",
          primary: "rgba(34, 211, 238, 1)",
          secondary: "rgba(99, 102, 241, 0.8)",
          glow: "rgba(34, 211, 238, 0.5)",
          particle: "rgba(165, 243, 252, 0.8)",
        };
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    // Initialize swirling particles
    const particleCount = 55;
    particlesRef.current = Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: Math.random() * 110 + 65,
      speed: (Math.random() * 0.015 + 0.008) * (Math.random() < 0.5 ? 1 : -1),
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.7 + 0.3,
      z: (Math.random() - 0.5) * 60,
    }));

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener("resize", handleResize);

    const dataArray = new Uint8Array(64);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth cursor lag
      mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * 0.06;
      mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * 0.06;

      const mouseDeltaX = (mouseRef.current.x - 0.5) * 50;
      const mouseDeltaY = (mouseRef.current.y - 0.5) * 40;

      const centerX = width / 2 + mouseDeltaX;
      const centerY = height / 2 + mouseDeltaY;

      // Real-time audio analyser polling
      let audioLevel = 0;
      let activeAnalyser = null;

      if (state === "speaking" && session?.outputAnalyser) {
        activeAnalyser = session.outputAnalyser;
      } else if (state === "listening" && session?.inputAnalyser) {
        activeAnalyser = session.inputAnalyser;
      }

      if (activeAnalyser) {
        try {
          activeAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += dataArray[i];
          }
          audioLevel = sum / 32; // 0..255
        } catch {}
      }

      // Smooth speech volume tracking
      const targetVol = audioLevel / 255;
      speechVolumeRef.current += (targetVol - speechVolumeRef.current) * 0.22;
      const vol = speechVolumeRef.current;

      // Rotation and pulse phase increment
      const speedMultiplier =
        characterState === "talking" || state === "speaking"
          ? 1.8 + vol * 2.0
          : characterState === "thinking" || state === "connecting"
          ? 1.6
          : 0.9;

      pulsePhaseRef.current += 0.035 * speedMultiplier;
      ringRotationRef.current += 0.012 * speedMultiplier;

      const palette = getPalette();

      // Dynamic base radius with breathing + audio excitation
      const breath = Math.sin(pulsePhaseRef.current) * 6;
      const audioExpansion = vol * 35;
      const baseRadius = 75 + breath + audioExpansion;

      // Spawn acoustic ripples when speaking or listening
      if ((state === "speaking" && vol > 0.12 && Math.random() < 0.25) ||
          (state === "listening" && Math.random() < 0.08)) {
        ripplesRef.current.push({
          radius: baseRadius,
          maxRadius: baseRadius + 140 + Math.random() * 40,
          opacity: 0.5,
          speed: 2.2 + vol * 3.0,
        });
      }

      // ----------------------------------------------------
      // 1. RENDER EXPANDING RESONANCE RIPPLES
      // ----------------------------------------------------
      for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
        const r = ripplesRef.current[i];
        r.radius += r.speed;
        const progress = (r.radius - baseRadius) / (r.maxRadius - baseRadius);
        r.opacity = Math.max(0, 0.5 * (1 - progress));

        if (r.opacity <= 0.01 || r.radius >= r.maxRadius) {
          ripplesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.strokeStyle = palette.primary.replace("1)", `${r.opacity * 0.7})`);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ----------------------------------------------------
      // 2. VOLUMETRIC ATMOSPHERIC CORONA GLOW
      // ----------------------------------------------------
      ctx.save();
      const outerGlowRadius = baseRadius * 2.8 + vol * 30;
      const coronaGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.4,
        centerX,
        centerY,
        outerGlowRadius
      );
      coronaGrad.addColorStop(0, palette.primary.replace("1)", "0.35)"));
      coronaGrad.addColorStop(0.35, palette.secondary.replace("0.8)", "0.18)"));
      coronaGrad.addColorStop(0.7, palette.glow.replace("0.5)", "0.06)"));
      coronaGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = coronaGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerGlowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ----------------------------------------------------
      // 3. 3D GYROSCOPIC ORBITAL RINGS
      // ----------------------------------------------------
      const rot = ringRotationRef.current;
      const tiltX = 0.55 + (mouseRef.current.y - 0.5) * 0.3;
      const tiltY = (mouseRef.current.x - 0.5) * 0.4;

      const drawOrbitalRing = (
        radius: number,
        angleOffset: number,
        color: string,
        lineWidth: number,
        numNodes = 0
      ) => {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(tiltY + angleOffset);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * tiltX, rot + angleOffset, 0, Math.PI * 2);
        ctx.stroke();

        // Orbital energy satellites along the ring
        for (let n = 0; n < numNodes; n++) {
          const nodeAngle = rot * 1.5 + (n * Math.PI * 2) / numNodes;
          const nx = Math.cos(nodeAngle) * radius;
          const ny = Math.sin(nodeAngle) * (radius * tiltX);

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(nx, ny, 2.5 + vol * 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Satellite glow
          ctx.fillStyle = palette.primary;
          ctx.beginPath();
          ctx.arc(nx, ny, 5 + vol * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };

      // Ring 1 — Major orbital ring with 2 glowing satellites
      drawOrbitalRing(
        baseRadius * 1.45 + Math.sin(pulsePhaseRef.current * 0.8) * 4,
        0,
        palette.primary.replace("1)", "0.55)"),
        1.5,
        2
      );

      // Ring 2 — Counter-rotating inclined ring with 1 satellite
      drawOrbitalRing(
        baseRadius * 1.75 + Math.cos(pulsePhaseRef.current * 0.7) * 5,
        Math.PI / 3,
        palette.secondary.replace("0.8)", "0.40)"),
        1.2,
        1
      );

      // Ring 3 — Outer equatorial quantum ring
      drawOrbitalRing(
        baseRadius * 2.1,
        -Math.PI / 4,
        palette.primary.replace("1)", "0.25)"),
        1.0,
        0
      );

      // ----------------------------------------------------
      // 4. SWIRLING PARTICLE CONSTELLATION
      // ----------------------------------------------------
      ctx.save();
      particlesRef.current.forEach((p) => {
        p.angle += p.speed * speedMultiplier;
        const currentDist = p.radius + breath * 0.5 + vol * 20;
        const px = centerX + Math.cos(p.angle) * currentDist;
        const py = centerY + Math.sin(p.angle) * (currentDist * 0.75) + p.z * 0.2;

        const particleAlpha = p.opacity * (0.6 + vol * 0.4);
        ctx.fillStyle = palette.particle.replace("0.8)", `${particleAlpha})`);
        ctx.beginPath();
        ctx.arc(px, py, p.size * (1 + vol * 0.5), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // ----------------------------------------------------
      // 5. INNER DEFORMING ENERGY SPHERE (WAVE HARMONICS)
      // ----------------------------------------------------
      ctx.save();
      const numSegments = 64;
      ctx.beginPath();

      for (let i = 0; i <= numSegments; i++) {
        const theta = (i / numSegments) * Math.PI * 2;
        // Harmonic deformation frequency
        const wave1 = Math.sin(theta * 4 + pulsePhaseRef.current * 2) * (3 + vol * 12);
        const wave2 = Math.cos(theta * 6 - pulsePhaseRef.current * 1.5) * (2 + vol * 8);
        const r = baseRadius + wave1 + wave2;

        const x = centerX + Math.cos(theta) * r;
        const y = centerY + Math.sin(theta) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      // Plasma Core Radial Gradient
      const coreGrad = ctx.createRadialGradient(
        centerX - baseRadius * 0.2,
        centerY - baseRadius * 0.25,
        baseRadius * 0.05,
        centerX,
        centerY,
        baseRadius
      );
      coreGrad.addColorStop(0, "#ffffff");
      coreGrad.addColorStop(0.2, palette.core);
      coreGrad.addColorStop(0.55, palette.primary);
      coreGrad.addColorStop(0.85, palette.secondary);
      coreGrad.addColorStop(1, palette.glow.replace("0.5)", "0.2)"));

      ctx.fillStyle = coreGrad;
      ctx.shadowColor = palette.primary;
      ctx.shadowBlur = 35 + vol * 25;
      ctx.fill();
      ctx.restore();

      // ----------------------------------------------------
      // 6. SPECULAR HIGHLIGHT & ENERGY CORE REFLECTION
      // ----------------------------------------------------
      ctx.save();
      const specX = centerX - baseRadius * 0.32;
      const specY = centerY - baseRadius * 0.32;
      const specGrad = ctx.createRadialGradient(
        specX,
        specY,
        2,
        specX,
        specY,
        baseRadius * 0.45
      );
      specGrad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      specGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.25)");
      specGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = specGrad;
      ctx.beginPath();
      ctx.arc(specX, specY, baseRadius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [session, state, themeColor, activeEmotion, characterState]);

  return (
    <div className="relative w-full h-full flex items-center justify-center pointer-events-none select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
};
