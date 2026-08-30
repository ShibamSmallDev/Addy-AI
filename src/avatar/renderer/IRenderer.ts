import type { ParamValueMap } from "../types";

export interface IRenderer {
  readonly type: "live2d" | "pixi" | "none";

  init(canvas: HTMLCanvasElement): Promise<void>;

  render(params: ParamValueMap, dt: number): void;

  resize(width: number, height: number): void;

  destroy(): void;
}
