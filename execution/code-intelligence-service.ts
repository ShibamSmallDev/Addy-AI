import { OpenCodeSdkAdapter } from './opencode-adapter';
import { LspStatus } from './types';

export interface CodeIntelligenceResult {
  lspStatus: LspStatus[];
  context: string[];
}

export class CodeIntelligenceService {
  constructor(private adapter: OpenCodeSdkAdapter) {}

  async getLspStatus(): Promise<LspStatus[]> {
    return this.adapter.getLspStatus();
  }

  async getFileContext(filePaths: string[], maxContextLength = 8000): Promise<string> {
    const chunks: string[] = [];
    let total = 0;

    for (const filePath of filePaths) {
      try {
        const content = await this.adapter.readFile(filePath);
        if (total + content.size > maxContextLength) {
          break;
        }
        chunks.push(`### ${filePath}\n${content.content}`);
        total += content.size;
      } catch {
        // skip unreadable files
      }
    }

    return chunks.join('\n\n');
  }

  async inspect(projectPath: string): Promise<CodeIntelligenceResult> {
    const lspStatus = await this.getLspStatus();
    const workspace = await this.adapter.inspectWorkspace(projectPath);
    const context = workspace.files.slice(0, 25);
    return { lspStatus, context };
  }
}
