import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { ParamValueMap } from "../types";
import type { IRenderer } from "./IRenderer";

export class PixiJSRenderer implements IRenderer {
  readonly type = "pixi" as const;

  private app: Application | null = null;
  private frame: Graphics | null = null;
  private glowRing: Graphics | null = null;
  private paramLabel: Text | null = null;
  private innerContainer: Container | null = null;
  private currentParams: ParamValueMap = {};

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      view: canvas,
      width: canvas.clientWidth || 512,
      height: canvas.clientHeight || 512,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    const { stage } = this.app;
    stage.removeChildren();

    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;

    this.glowRing = new Graphics();
    stage.addChild(this.glowRing);

    this.frame = new Graphics();
    stage.addChild(this.frame);

    this.innerContainer = new Container();
    stage.addChild(this.innerContainer);

    const style = new TextStyle({
      fontFamily: "monospace",
      fontSize: 9,
      fill: 0x22d3ee,
      letterSpacing: 2,
    });
    this.paramLabel = new Text({ text: "", style });
    this.paramLabel.anchor.set(0.5, 1);
    this.paramLabel.x = cx;
    this.paramLabel.y = cy + 170;
    stage.addChild(this.paramLabel);

    this.resize(canvas.clientWidth || 512, canvas.clientHeight || 512);
    this.drawFrame(0.3);
  }

  render(params: ParamValueMap, _dt: number): void {
    if (!this.app) return;

    this.currentParams = params;

    const glow = params["ParamCoreGlow"] ?? 0.3;
    const blink = params["ParamEyeLOpen"] ?? 1;
    const blush = params["ParamBlush"] ?? 0;
    const glitch = params["ParamGlitch"] ?? 0;
    const mouth = params["ParamMouthForm"] ?? 0.25;

    this.drawFrame(glow, blush, glitch);

    if (this.paramLabel) {
      const active = Object.entries(params)
        .filter(([, v]) => Math.abs(v) > 0.01)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join("  ");
      this.paramLabel.text = active || "AWAITING SIGNAL";
    }

    this.applyGlitch(glitch);
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
    this.drawFrame(this.currentParams["ParamCoreGlow"] ?? 0.3);
  }

  destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.frame = null;
    this.glowRing = null;
    this.paramLabel = null;
    this.innerContainer = null;
  }

  private drawFrame(glow: number, blush = 0, glitch = 0): void {
    const mouth = this.currentParams["ParamMouthForm"] ?? 0.25;
    if (!this.app || !this.frame || !this.glowRing || !this.innerContainer) return;

    const { width, height } = this.app.screen;
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.min(width, height) * 0.35;

    const baseAlpha = Math.min(0.15 + glow * 0.5, 0.65);
    const glowAlpha = Math.min(0.08 + glow * 0.2, 0.28);
    const blushR = Math.min(blush * 20, 12);
    const jitter = glitch > 0.1 ? (Math.random() - 0.5) * glitch * 12 : 0;
    const jx = cx + jitter;
    const jy = cy + jitter * 0.3;

    this.glowRing.clear();
    this.glowRing.circle(jx, jy, R + 24);
    this.glowRing.fill({ color: blush > 0.5 ? 0xec4899 : 0x06b6d4, alpha: glowAlpha * 0.6 });
    this.glowRing.circle(jx, jy, R + 12);
    this.glowRing.fill({ color: blush > 0.5 ? 0xf43f5e : 0x22d3ee, alpha: glowAlpha });

    this.frame.clear();
    this.frame.circle(jx, jy, R);
    this.frame.stroke({ color: blush > 0.5 ? 0xec4899 : 0x22d3ee, alpha: baseAlpha, width: 1.5 });

    this.frame.circle(jx, jy, R + 3);
    this.frame.stroke({ color: 0xffffff, alpha: baseAlpha * 0.3, width: 0.5 });

    const tickCount = 24;
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const innerR = R - 6;
      const outerR = R + 2;
      const active = i % 3 === 0;
      const alpha = active ? baseAlpha * 0.8 : baseAlpha * 0.25;
      this.frame.moveTo(jx + Math.cos(angle) * innerR, jy + Math.sin(angle) * innerR);
      this.frame.lineTo(jx + Math.cos(angle) * outerR, jy + Math.sin(angle) * outerR);
      this.frame.stroke({ color: active ? 0x22d3ee : 0xffffff, alpha, width: active ? 1.2 : 0.6 });
    }

    if (glow > 0.5) {
      this.frame.circle(jx, jy, R * 0.15);
      this.frame.fill({ color: 0x22d3ee, alpha: (glow - 0.5) * 0.15 });
    }

    const chinY = jy + R * 0.15;
    const faceW = R * 0.22;

    this.innerContainer.removeChildren();

    if (glitch < 0.3) {
      const face = new Graphics();

      const eyeOpen = this.currentParams["ParamEyeLOpen"] ?? 1;
      const eyeH = Math.max(1, eyeOpen * R * 0.06);
      const eyeY = chinY - R * 0.04;

      face.circle(jx - faceW * 0.4, eyeY, 2.5);
      face.fill({ color: 0x22d3ee, alpha: 0.7 });

      face.circle(jx + faceW * 0.4, eyeY, 2.5);
      face.fill({ color: 0x22d3ee, alpha: 0.7 });

      if (eyeOpen > 0.3) {
        face.circle(jx - faceW * 0.4, eyeY, 1.2);
        face.fill({ color: 0xffffff, alpha: 0.6 });
        face.circle(jx + faceW * 0.4, eyeY, 1.2);
        face.fill({ color: 0xffffff, alpha: 0.6 });
      }

      const mouthH = Math.min(Math.abs(mouth) * R * 0.04, R * 0.04);
      const mouthY = chinY + R * 0.06;
      face.moveTo(jx - faceW * 0.2, mouthY);
      face.bezierCurveTo(
        jx - faceW * 0.1, mouthY + mouthH * (mouth > 0 ? -1 : 1),
        jx + faceW * 0.1, mouthY + mouthH * (mouth > 0 ? -1 : 1),
        jx + faceW * 0.2, mouthY,
      );
      face.stroke({ color: 0x22d3ee, alpha: 0.5 + blush * 0.3, width: 1 });

      if (blush > 0.1) {
        face.circle(jx - faceW * 0.65, chinY, 4 + blushR * 0.3);
        face.fill({ color: 0xec4899, alpha: blush * 0.15 });
        face.circle(jx + faceW * 0.65, chinY, 4 + blushR * 0.3);
        face.fill({ color: 0xec4899, alpha: blush * 0.15 });
      }

      this.innerContainer.addChild(face);
    }
  }

  private applyGlitch(glitch: number): void {
    if (!this.app || !this.frame) return;
    if (glitch > 0.1) {
      this.frame.alpha = 0.6 + Math.random() * 0.4;
    } else {
      this.frame.alpha = 1;
    }
  }
}
