import type { IRenderer } from "./IRenderer";
import { PixiJSRenderer } from "./PixiJSRenderer";
import { Live2DRenderer } from "./Live2DRenderer";

export class RendererManager {
  private renderer: IRenderer = { type: "none" as const, init: async () => {}, render: () => {}, resize: () => {}, destroy: () => {} };

  async select(canvas: HTMLCanvasElement): Promise<IRenderer> {
    const live2d = new Live2DRenderer();
    await live2d.init(canvas);

    if (live2d.type === "live2d") {
      const typed = live2d as Live2DRenderer;
      if (typeof (typed as any).ready === "undefined" || (typed as any).ready) {
        this.renderer = live2d;
        return this.renderer;
      }
    }
    live2d.destroy();

    const pixi = new PixiJSRenderer();
    await pixi.init(canvas);
    this.renderer = pixi;
    return this.renderer;
  }

  get active(): IRenderer {
    return this.renderer;
  }

  get type(): string {
    return this.renderer.type;
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
