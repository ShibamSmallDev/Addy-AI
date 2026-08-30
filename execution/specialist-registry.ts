export type SpecialistId = 'adventurer' | 'architect' | 'builder' | 'diagnose' | 'planner' | 'reviewer' | 'writer';

export interface SpecialistDefinition {
  id: SpecialistId;
  name: string;
  description: string;
  role: 'codebase-recon' | 'architecture' | 'implementation' | 'debugging' | 'planning' | 'review' | 'documentation';
}

export interface SpecialistRegistry {
  list(): Promise<SpecialistDefinition[]>;
  get(id: SpecialistId): Promise<SpecialistDefinition | undefined>;
}

export interface HermesPrepInterface {
  adapter: unknown;
  mcpService: unknown;
  codeIntelligence: unknown;
  skills: SkillRegistry;
  workflowMemory: WorkflowMemory;
  conversationSearch: ConversationSearch;
  memoryLearning: MemoryLearning;
}

export interface OpenClawPrepInterface {
  sessionRegistry: unknown;
  permissionService: unknown;
  workspaceContext: WorkspaceContextReader;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  requiredTools: string[];
  steps: string[];
}

export interface SkillRegistry {
  listSkills(): Promise<SkillDefinition[]>;
  findSkill(text: string): Promise<SkillDefinition | undefined>;
  recordSkill(skill: SkillDefinition): Promise<void>;
}

export interface WorkflowMemory {
  recordWorkflow(taskDescription: string, steps: string[]): Promise<void>;
  findWorkflows(similarTo: string): Promise<Array<{ description: string; steps: string[] }>>;
}

export interface ConversationSearch {
  search(query: string, limit?: number): Promise<Array<{ text: string; timestamp: number }>>;
}

export interface MemoryLearning {
  extractFromExecution(result: unknown): Promise<string[]>;
  storeInsight(insight: string, category: string): Promise<void>;
}

export interface WorkspaceContextReader {
  readContext(workspacePath: string): Promise<Array<{ file: string; content: string }>>;
}
