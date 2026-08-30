import { BlendPriority, type ParamValueMap } from "./types";
import { EventBus } from "./EventBus";

const MOUTH_PARAMS = new Set(["ParamMouthForm", "ParamMouthOpenY"]);

interface BlendLayer {
  priority: BlendPriority;
  params: ParamValueMap;
  blendFactor: number;
}

export class ParamBlender {
  private layers = new Map<BlendPriority, BlendLayer>();
  private prevOutput: ParamValueMap = {};
  private overrides: ParamValueMap = {};

  constructor(private bus: EventBus) {}

  setLayer(
    priority: BlendPriority,
    params: ParamValueMap,
    blendFactor: number = 1,
  ): void {
    this.layers.set(priority, { priority, params, blendFactor });
    this.flush();
  }

  removeLayer(priority: BlendPriority): void {
    this.layers.delete(priority);
    this.flush();
  }

  clear(): void {
    this.layers.clear();
    this.overrides = {};
    this.prevOutput = {};
    this.bus.emit({ type: "param:update", params: {} });
  }

  setOverride(key: string, value: number): void {
    this.overrides[key] = value;
    this.flush();
  }

  removeOverride(key: string): void {
    delete this.overrides[key];
    this.flush();
  }

  clearOverrides(): void {
    this.overrides = {};
    this.flush();
  }

  private flush(): void {
    const result = this.blend();
    this.bus.emit({ type: "param:update", params: result });
  }

  private blend(): ParamValueMap {
    const sorted = [...this.layers.values()].sort((a, b) => a.priority - b.priority);
    const result: ParamValueMap = {};

    for (const layer of sorted) {
      if (layer.blendFactor <= 0) continue;

      for (const [key, target] of Object.entries(layer.params)) {
        const belongsToHighest = isHighestForParam(sorted, key, layer.priority);
        if (!belongsToHighest) continue;

        const prev = this.prevOutput[key];
        if (MOUTH_PARAMS.has(key) && layer.priority >= BlendPriority.HighAction) {
          result[key] = target;
        } else if (prev !== undefined) {
          result[key] = prev + (target - prev) * layer.blendFactor;
        } else {
          result[key] = target * layer.blendFactor;
        }
      }
    }

    for (const [key, value] of Object.entries(this.overrides)) {
      result[key] = value;
    }

    this.prevOutput = { ...result };
    return result;
  }
}

function isHighestForParam(
  layers: BlendLayer[],
  paramKey: string,
  priority: BlendPriority,
): boolean {
  const isMouth = MOUTH_PARAMS.has(paramKey);
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.priority < priority && !isMouth) continue;
    if (l.priority <= priority) break;
    if (paramKey in l.params) return false;
  }
  return true;
}
