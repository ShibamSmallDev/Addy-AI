import {
  AnimationState,
  BlendPriority,
  STATE_PRIORITY,
  type AnimationSpec,
  type ActiveTransition,
  type TransitionOptions,
  easeInOutCubic,
  snapCurve,
} from "./types";
import { EventBus } from "./EventBus";

interface LayerState {
  state: AnimationState;
  spec: AnimationSpec;
  elapsed: number;
}

interface QueuedRequest {
  state: AnimationState;
  spec: AnimationSpec;
  options: TransitionOptions;
}

const DEFAULT_OPTS: TransitionOptions = {
  queue: false,
  cancelable: true,
};

export class StateMachine {
  private layers = new Map<BlendPriority, LayerState>();
  private transitions = new Map<BlendPriority, ActiveTransition>();
  private queues = new Map<BlendPriority, QueuedRequest[]>();
  private suspended = new Map<BlendPriority, LayerState>();

  constructor(
    private bus: EventBus,
    private specMap: Map<AnimationState, AnimationSpec>,
  ) {}

  transitionTo(
    state: AnimationState,
    options?: TransitionOptions,
  ): void {
    const spec = this.specMap.get(state);
    if (!spec) return;

    const opts = { ...DEFAULT_OPTS, ...options };
    const priority = opts.priority ?? STATE_PRIORITY[state];

    const existingTransition = this.transitions.get(priority);
    const existingLayer = this.layers.get(priority);

    if (existingTransition && opts.queue) {
      this.enqueue(priority, { state, spec, options: opts });
      this.bus.emit({ type: "queue:changed", priority, length: this.queues.get(priority)?.length ?? 0 });
      return;
    }

    if (existingTransition && !existingTransition.cancelable) {
      this.enqueue(priority, { state, spec, options: opts });
      this.bus.emit({ type: "queue:changed", priority, length: this.queues.get(priority)?.length ?? 0 });
      return;
    }

    if (existingLayer && !spec.interruptible) {
      this.enqueue(priority, { state, spec, options: opts });
      this.bus.emit({ type: "queue:changed", priority, length: this.queues.get(priority)?.length ?? 0 });
      return;
    }

    if (priority >= BlendPriority.Interrupt) {
      this.suspendBelow(priority);
    }

    const from = existingLayer?.state ?? null;
    const duration = opts.duration ?? spec.transitionIn.duration;
    const easing = duration <= 0.05 ? snapCurve : (spec.transitionIn.easing ?? easeInOutCubic);

    this.layers.set(priority, { state, spec, elapsed: 0 });
    this.transitions.set(priority, {
      from,
      to: state,
      priority,
      elapsed: 0,
      duration,
      easing,
      cancelable: opts.cancelable ?? true,
    });

    this.bus.emit({ type: "state:change", state, priority, previous: from });
    this.bus.emit({ type: "transition:start", from, to: state, priority, duration });
  }

  cancelTransition(priority: BlendPriority): void {
    const t = this.transitions.get(priority);
    if (!t) return;

    if (!t.cancelable) return;

    this.transitions.delete(priority);

    this.bus.emit({ type: "transition:cancelled", priority, state: t.to });

    if (t.from) {
      const fromSpec = this.specMap.get(t.from);
      if (fromSpec) {
        this.layers.set(priority, { state: t.from, spec: fromSpec, elapsed: 0 });
        this.bus.emit({ type: "state:change", state: t.from, priority, previous: null });
      } else {
        this.layers.delete(priority);
      }
    } else {
      this.layers.delete(priority);
    }

    this.processQueue(priority);
  }

  cancelAll(): void {
    for (const priority of this.transitions.keys()) {
      this.cancelTransition(priority);
    }
  }

  getActiveState(priority: BlendPriority): AnimationState | null {
    return this.layers.get(priority)?.state ?? null;
  }

  getActiveLayer(priority: BlendPriority): { state: AnimationState; elapsed: number } | undefined {
    const l = this.layers.get(priority);
    return l ? { state: l.state, elapsed: l.elapsed } : undefined;
  }

  getAllActiveLayers(): { state: AnimationState; priority: BlendPriority; elapsed: number }[] {
    return Array.from(this.layers.entries()).map(([priority, layer]) => ({
      state: layer.state,
      priority,
      elapsed: layer.elapsed,
    }));
  }

  getActiveTransition(priority: BlendPriority): ActiveTransition | null {
    return this.transitions.get(priority) ?? null;
  }

  getAllTransitions(): ActiveTransition[] {
    return Array.from(this.transitions.values());
  }

  isInTransition(priority?: BlendPriority): boolean {
    if (priority !== undefined) return this.transitions.has(priority);
    return this.transitions.size > 0;
  }

  getQueueLength(priority: BlendPriority): number {
    return this.queues.get(priority)?.length ?? 0;
  }

  hasQueuedTransitions(): boolean {
    for (const q of this.queues.values()) {
      if (q.length > 0) return true;
    }
    return false;
  }

  getStateSnapshot(): Record<string, unknown> {
    const layers: Record<string, { state: string; elapsed: number }> = {};
    for (const [p, l] of this.layers) {
      layers[`priority_${p}`] = { state: l.state, elapsed: Math.round(l.elapsed * 100) / 100 };
    }
    const activeTransitions: Record<string, unknown> = {};
    for (const [p, t] of this.transitions) {
      activeTransitions[`priority_${p}`] = {
        from: t.from,
        to: t.to,
        progress: Math.round((t.duration > 0 ? Math.min(t.elapsed / t.duration, 1) : 1) * 100) / 100,
      };
    }
    const queueLengths: Record<string, number> = {};
    for (const [p, q] of this.queues) {
      if (q.length > 0) queueLengths[`priority_${p}`] = q.length;
    }
    return {
      layers,
      activeTransitions,
      queueLengths: Object.keys(queueLengths).length > 0 ? queueLengths : "none",
    };
  }

  update(dt: number): void {
    for (const [priority, t] of this.transitions) {
      t.elapsed += dt;
      const progress = t.duration > 0 ? Math.min(t.elapsed / t.duration, 1) : 1;
      this.bus.emit({ type: "transition:tick", priority, progress, from: t.from, to: t.to });

      if (progress >= 1) {
        this.transitions.delete(priority);
        this.bus.emit({ type: "transition:complete", priority, state: t.to });
        this.bus.emit({ type: "state:entered", state: t.to, priority, from: t.from });

        this.processQueue(priority);
      }
    }

    for (const [priority, layer] of this.layers) {
      layer.elapsed += dt;
      if (!layer.spec.looping && layer.elapsed >= layer.spec.duration) {
        this.bus.emit({ type: "state:end", state: layer.state });
        this.bus.emit({ type: "state:exited", state: layer.state, priority, to: null });
        this.layers.delete(priority);

        if (priority >= BlendPriority.Interrupt) {
          this.restoreSuspended(priority);
        }
      }
    }
  }

  reset(): void {
    this.layers.clear();
    this.transitions.clear();
    this.queues.clear();
    this.suspended.clear();
  }

  private enqueue(priority: BlendPriority, request: QueuedRequest): void {
    let q = this.queues.get(priority);
    if (!q) {
      q = [];
      this.queues.set(priority, q);
    }
    q.push(request);
  }

  private processQueue(priority: BlendPriority): void {
    const q = this.queues.get(priority);
    if (!q || q.length === 0) return;

    const next = q.shift()!;
    this.bus.emit({ type: "queue:changed", priority, length: q.length });

    this.transitionTo(next.state, next.options);
  }

  private suspendBelow(threshold: BlendPriority): void {
    for (const [p, layer] of this.layers) {
      if (p < threshold && p !== BlendPriority.Base) {
        this.suspended.set(p, layer);
        this.layers.delete(p);
        this.bus.emit({ type: "state:exited", state: layer.state, priority: p, to: null });
        this.transitions.delete(p);
      }
    }
  }

  private restoreSuspended(threshold: BlendPriority): void {
    for (const [p, layer] of this.suspended) {
      if (p < threshold && p !== BlendPriority.Base) {
        this.layers.set(p, layer);
        this.bus.emit({ type: "state:change", state: layer.state, priority: p, previous: null });
        this.bus.emit({ type: "state:entered", state: layer.state, priority: p, from: null });
      }
    }

    for (const p of this.suspended.keys()) {
      if (p < threshold && p !== BlendPriority.Base) {
        this.suspended.delete(p);
      }
    }
  }
}
