import React, { useEffect, useRef, useCallback } from "react";
import type { ParamValueMap } from "../avatar/types";
import { RendererManager } from "../avatar/renderer/RendererManager";
import type { IRenderer } from "../avatar/renderer/IRenderer";

interface AvatarCanvasProps {
  engine: { getParams(): Readonly<ParamValueMap>; on(handler: (event: any) => void): () => void } | null;
  className?: string;
}

export const AvatarCanvas: React.FC<AvatarCanvasProps> = ({ engine, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<IRenderer | null>(null);
  const managerRef = useRef<RendererManager | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const loop = useCallback((time: number) => {
    const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 1 / 60;
    lastTimeRef.current = time;

    const renderer = rendererRef.current;
    const mgr = managerRef.current;
    if (renderer && mgr && engine) {
      const params = engine.getParams();
      renderer.render(params, dt);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const manager = new RendererManager();
    managerRef.current = manager;

    manager.select(canvas).then((renderer) => {
      rendererRef.current = renderer;
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(loop);
    });

    const handleResize = () => {
      const r = rendererRef.current;
      if (r && canvas) {
        r.resize(canvas.clientWidth, canvas.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      manager.destroy();
      managerRef.current = null;
      rendererRef.current = null;
    };
  }, [loop]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full block ${className}`}
      style={{ imageRendering: "auto" }}
    />
  );
};
