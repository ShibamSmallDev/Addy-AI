export enum AnimationState {
  Idle = "IDLE",
  Talking = "TALKING",
  Reading = "READING",
  Thinking = "THINKING",
  Greeting = "GREETING",
  Wake = "WAKE",
  Sleep = "SLEEP",
  Embarrassed = "EMBARRASSED",
  Happy = "HAPPY",
  Confused = "CONFUSED",
  Error = "ERROR",
  Coding = "CODING",
  Compiling = "COMPILING",
  Debugging = "DEBUGGING",
  Searching = "SEARCHING",
  Notification = "NOTIFICATION",
}

export enum BlendPriority {
  Base = 0,
  Workflow = 2,
  HighAction = 3,
  Interrupt = 4,
  Emergency = 5,
}

export type ParamValueMap = Record<string, number>;

export interface StateTransition {
  duration: number;
  easing: (t: number) => number;
}

export interface AnimationSpec {
  state: AnimationState;
  priority: BlendPriority;
  duration: number;
  looping: boolean;
  params: ParamValueMap;
  physics: PhysicsConfig;
  transitionIn: StateTransition;
  transitionOut: StateTransition;
  interruptible: boolean;
}

export interface PhysicsConfig {
  gravity: number;
  damping: number;
  tension: number;
  elasticity: number;
}

export interface TransitionOptions {
  queue?: boolean;
  cancelable?: boolean;
  duration?: number;
  priority?: BlendPriority;
}

export interface ActiveTransition {
  from: AnimationState | null;
  to: AnimationState;
  priority: BlendPriority;
  elapsed: number;
  duration: number;
  easing: (t: number) => number;
  cancelable: boolean;
}

export type AvatarEvent =
  | { type: "state:change"; state: AnimationState; priority: BlendPriority; previous: AnimationState | null }
  | { type: "state:entered"; state: AnimationState; priority: BlendPriority; from: AnimationState | null }
  | { type: "state:exited"; state: AnimationState; priority: BlendPriority; to: AnimationState | null }
  | { type: "state:end"; state: AnimationState }
  | { type: "param:update"; params: ParamValueMap }
  | { type: "audio:level"; level: number }
  | { type: "transition:start"; from: AnimationState | null; to: AnimationState; priority: BlendPriority; duration: number }
  | { type: "transition:tick"; priority: BlendPriority; progress: number; from: AnimationState | null; to: AnimationState }
  | { type: "transition:complete"; priority: BlendPriority; state: AnimationState }
  | { type: "transition:cancelled"; priority: BlendPriority; state: AnimationState }
  | { type: "queue:changed"; priority: BlendPriority; length: number }
  | { type: "error"; message: string };

export type AvatarEventHandler = (event: AvatarEvent) => void;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function snapCurve(t: number): number {
  return t < 1 ? 0 : 1;
}

export const STATE_PRIORITY: Record<AnimationState, BlendPriority> = {
  [AnimationState.Idle]: BlendPriority.Base,
  [AnimationState.Sleep]: BlendPriority.Base,
  [AnimationState.Reading]: BlendPriority.Workflow,
  [AnimationState.Thinking]: BlendPriority.Workflow,
  [AnimationState.Confused]: BlendPriority.Workflow,
  [AnimationState.Compiling]: BlendPriority.Workflow,
  [AnimationState.Debugging]: BlendPriority.Workflow,
  [AnimationState.Searching]: BlendPriority.Workflow,
  [AnimationState.Talking]: BlendPriority.HighAction,
  [AnimationState.Coding]: BlendPriority.HighAction,
  [AnimationState.Happy]: BlendPriority.HighAction,
  [AnimationState.Embarrassed]: BlendPriority.HighAction,
  [AnimationState.Wake]: BlendPriority.Interrupt,
  [AnimationState.Greeting]: BlendPriority.Interrupt,
  [AnimationState.Error]: BlendPriority.Emergency,
  [AnimationState.Notification]: BlendPriority.Emergency,
};
