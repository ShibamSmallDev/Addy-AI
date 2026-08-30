import { OpenCodeSdkAdapter } from './opencode-adapter';
import { OpenCodeAgent } from './types';

export class OpenCodeAgentRegistry {
  constructor(private adapter: OpenCodeSdkAdapter) {}

  async listAgents(): Promise<OpenCodeAgent[]> {
    return this.adapter.listAgents();
  }

  async getAgent(id: string): Promise<OpenCodeAgent | undefined> {
    const agents = await this.listAgents();
    return agents.find((a) => a.id === id || a.name === id);
  }
}
