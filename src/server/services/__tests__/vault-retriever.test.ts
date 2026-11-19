process.env.DB_PATH = ':memory:';

import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let capturedPrompt = '';
vi.mock('../headless-cli.js', () => ({
  resolveCliTool: () => 'claude',
  runHeadless: vi.fn(async (_tool: string, prompt: string) => {
    capturedPrompt = prompt;
    return '["a.html"]';
  }),
}));

const { getDatabase, closeDatabase } = await import('../../db/connection.js');
const queries = await import('../../db/queries.js');
const { selectRelevantFiles } = await import('../vault-retriever.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-retriever-'));

afterAll(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('selectRelevantFiles', () => {
  it('shows app-DB tags (first) next to the file tags in the candidate list', async () => {
    getDatabase().prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'one', ?)`).run(root);
    fs.writeFileSync(path.join(root, 'a.html'), '<title>Report</title>body');
    fs.writeFileSync(path.join(root, 'b.md'), '---\ntags: [own]\n---\ntext');
    queries.setVaultFileTags('p1', 'a.html', ['GPU']);
    queries.setVaultFileTags('p1', 'b.md', ['app']);

    const result = await selectRelevantFiles('p1', root, 'GPU 작업');

    expect(result.selectedPaths).toEqual(['a.html']);
    expect(capturedPrompt).toContain('path="a.html" title="Report" [GPU]');
    expect(capturedPrompt).toContain('path="b.md" title="b" [app, own]');
  });
});
