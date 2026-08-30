export interface Memory {
  id: string;
  category: "identity" | "preference" | "goal" | "project" | "relationship" | "emotional" | "behavior" | "session" | "general" | "important_event" | "conversation" | "reminder" | "active_task" | "debug_session" | "decision" | "project_note" | "milestone" | "bug_report";
  text: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  status?: string;
  importance?: number;
  confidence?: number;
}

export type MemoryCategory = Memory["category"];

export interface MemoryTransaction {
  action: "ADD" | "UPDATE" | "REMOVE";
  id: string;
  category: MemoryCategory;
  text: string;
}
