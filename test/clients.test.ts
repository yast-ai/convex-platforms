import { describe, expect, test } from 'bun:test';
import { generateClients } from '../src/clients.js';
import type { Operation } from '../src/contract.js';

const operation: Operation = {
  name: 'getTodo',
  resource: ['todos'],
  action: 'get',
  tool: 'todos_get',
  path: '/api/v1/todos/get',
  function: 'todos/internal:getTodo',
  type: 'query',
  platforms: ['sdk-typescript', 'sdk-python'],
  description: 'Get todo',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  outputSchema: { type: 'object', properties: { done: { type: 'boolean' } }, required: ['done'] },
};
describe('generated clients', () => {
  test('uses runtime URL/token transport and preserves nested resource methods', async () => {
    const ts = await generateClients([operation], 'sdk-typescript', '@disposabl/convex-platforms');
    expect(ts['sdk-typescript.ts']).toContain('new URL(siteUrl)');
    expect(ts['sdk-typescript.ts']).toContain('"todos"');
    const py = await generateClients([operation], 'sdk-python', '@disposabl/convex-platforms');
    expect(py['sdk-python.py']).toContain('def get');
  });
});
