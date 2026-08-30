import {
  AnimationState,
  BlendPriority,
  STATE_PRIORITY,
  type AnimationSpec,
  type ParamValueMap,
  type AvatarEventHandler,
  type TransitionOptions,
} from "./types";
import { EventBus } from "./EventBus";
import { StateMachine } from "./StateMachine";
import { ParamBlender } from "./ParamBlender";
import { SPEC_MAP } from "./AnimationRegistry";

export class AvatarEngine {
  readonly bus = new EventBus();
  readonly stateMachine: StateMachine;
  private paramBlender: ParamBlender;
  private animating = false;
  private rafId: number | null = null;
  private lastParams: ParamValueMap = {};

  private animSpecs: Map<AnimationState, AnimationSpec>;

  constructor(specs?: Map<AnimationState, AnimationSpec>) {
    this.animSpecs = specs ?? SPEC_MAP;
    this.stateMachine = new StateMachine(this.bus, this.animSpecs);
    this.paramBlender = new ParamBlender(this.bus);

    this.bus.on("param:update", (event) => {
      if (event.type === "param:update") {
        this.lastParams = event.params;
      }
    });

    this.bus.on("transition:tick", (event) => {
      if (event.type === "transition:tick") {
        this.onTransitionTick(event.priority, event.progress, event.to);
      }
    });

    this.bus.on("transition:complete", (event) => {
      if (event.type === "transition:complete") {
        this.onTransitionComplete(event.priority, event.state);
      }
    });

    this.bus.on("state:exited", (event) => {
      if (event.type === "state:exited") {
        this.onStateExited(event.state, event.priority);
      }
    });

    this.bus.on("transition:cancelled", (event) => {
      if (event.type === "transition:cancelled") {
        this.onTransitionCancelled(event.priority, event.state);
      }
    });
  }

  start(baseState: AnimationState = AnimationState.Idle): void {
    this.stateMachine.transitionTo(baseState);
    this.animating = true;

    const loop = () => {
      if (!this.animating) return;
      this.update(1 / 60);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.animating = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setState(state: AnimationState, options?: TransitionOptions): void {
    this.stateMachine.transitionTo(state, options);
  }

  cancelTransition(priority?: BlendPriority): void {
    if (priority !== undefined) {
      this.stateMachine.cancelTransition(priority);
    } else {
      this.stateMachine.cancelAll();
    }
  }

  getParams(): Readonly<ParamValueMap> {
    return this.lastParams;
  }

  on(handler: AvatarEventHandler): () => void {
    return this.bus.onAny(handler);
  }

  getActiveStates(): AnimationState[] {
    return this.stateMachine.getAllActiveLayers().map((l) => l.state);
  }

  isInState(state: AnimationState): boolean {
    return this.stateMachine.getAllActiveLayers().some((l) => l.state === state);
  }

  setDebugParam(key: string, value: number): void {
    this.paramBlender.setOverride(key, value);
  }

  removeDebugParam(key: string): void {
    this.paramBlender.removeOverride(key);
  }

  clearDebugParams(): void {
    this.paramBlender.clearOverrides();
  }

  private update(dt: number): void {
    this.stateMachine.update(dt);
  }

  private onTransitionTick(priority: BlendPriority, progress: number, to: AnimationState): void {
    const spec = this.animSpecs.get(to);
    if (!spec) return;

    const eased = spec.transitionIn.easing(progress);
    this.paramBlender.setLayer(priority, spec.params, eased);
  }

  private onTransitionComplete(priority: BlendPriority, state: AnimationState): void {
    const spec = this.animSpecs.get(state);
    if (!spec) return;
    this.paramBlender.setLayer(priority, spec.params, 1);
  }

  private onStateExited(state: AnimationState, priority: BlendPriority): void {
    this.paramBlender.removeLayer(priority);
  }

  private onTransitionCancelled(priority: BlendPriority, state: AnimationState): void {
    this.paramBlender.removeLayer(priority);

    const current = this.stateMachine.getActiveLayer(priority);
    if (current) {
      const spec = this.animSpecs.get(current.state);
      if (spec) {
        this.paramBlender.setLayer(priority, spec.params, 1);
      }
    }
  }

  destroy(): void {
    this.stop();
    this.stateMachine.reset();
    this.paramBlender.clear();
    this.bus.clear();
  }
}
