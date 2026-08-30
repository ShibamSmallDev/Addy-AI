import type { AvatarEvent, AvatarEventHandler } from "./types";

type EventType = AvatarEvent["type"];

export class EventBus {
  private listeners = new Map<EventType, Set<AvatarEventHandler>>();
  private wildcard: Set<AvatarEventHandler> = new Set();

  on(type: EventType, handler: AvatarEventHandler): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  onAny(handler: AvatarEventHandler): () => void {
    this.wildcard.add(handler);
    return () => { this.wildcard.delete(handler); };
  }

  off(type: EventType, handler: AvatarEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(event: AvatarEvent): void {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }
    for (const handler of this.wildcard) {
      handler(event);
    }
  }

  clear(): void {
    this.listeners.clear();
    this.wildcard.clear();
  }

  get listenerCount(): number {
    let count = this.wildcard.size;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}
