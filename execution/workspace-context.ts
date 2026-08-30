import fs from 'fs';
import path from 'path';
import { WorkspaceContextReader } from './specialist-registry';

const CONTEXT_FILES = ['ADDY.md', 'PROJECT.md', 'AGENTS.md'];

export class DefaultWorkspaceContextReader implements WorkspaceContextReader {
  constructor(private fileNames: string[] = CONTEXT_FILES) {}

  async readContext(workspacePath: string): Promise<Array<{ file: string; content: string }>> {
    const found: Array<{ file: string; content: string }> = [];
    for (const fileName of this.fileNames) {
      const filePath = path.join(workspacePath, fileName);
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          found.push({ file: fileName, content });
        }
      } catch {
        // unreadable context files are skipped
      }
    }
    return found;
  }

  async readContextFile(workspacePath: string, fileName: string): Promise<string | undefined> {
    const contexts = await this.readContext(workspacePath);
    const match = contexts.find((c) => c.file === fileName);
    return match?.content;
  }
}
