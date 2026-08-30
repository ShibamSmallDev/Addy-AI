import type { ParamValueMap } from "../types";
import type { IRenderer } from "./IRenderer";

const MODEL_PATH = "/models/Addy/Addy.model3.json";

export class Live2DRenderer implements IRenderer {
  readonly type = "live2d" as const;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: WebGLRenderingContext | null = null;
  private ready = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });

    if (!gl) {
      console.warn("[Live2DRenderer] WebGL not available");
      return;
    }
    this.ctx = gl;

    const available = await this.checkModelExists();
    if (!available) {
      console.warn("[Live2DRenderer] Addy model files not found at", MODEL_PATH);
      return;
    }

    const coreLoaded = await this.loadCoreEngine();
    if (!coreLoaded) {
      console.warn("[Live2DRenderer] Live2D Cubism Core not loaded");
      return;
    }

    this.ready = true;
    console.log("[Live2DRenderer] Ready — Cubism Core + model files available");
  }

  render(_params: ParamValueMap, _dt: number): void {
    if (!this.ready || !this.ctx || !this.canvas) return;
    const gl = this.ctx;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.flush();
  }

  resize(width: number, height: number): void {
    if (!this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  destroy(): void {
    this.ready = false;
    this.canvas = null;
    this.ctx = null;
  }

  private async checkModelExists(): Promise<boolean> {
    try {
      const res = await fetch(MODEL_PATH, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  private loadCoreEngine(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof (window as any).Live2DCubismCore !== "undefined") {
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = "/live2dcubismcore.min.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
}
