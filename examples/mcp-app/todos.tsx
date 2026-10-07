import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { createMcpApp, useMcpTheme, useMcpToolResult } from '@disposabl/convex-platforms/react';
import type { AppToolResult } from '@modelcontextprotocol/ext-apps';
import { TodoList, type Todo } from './TodoList.js';

type TodoPage = { page: Todo[]; isDone: boolean; continueCursor: string };
type TodoToolResult = { result: TodoPage };

const app = createMcpApp('Convex Platforms todos example');

function isTodoResult(value: unknown): value is TodoToolResult {
  if (!value || typeof value !== 'object' || !('result' in value)) return false;
  const result = (value as { result?: unknown }).result;
  return Boolean(result && typeof result === 'object' && Array.isArray((result as { page?: unknown }).page));
}

function TodosMcpApp() {
  const theme = useMcpTheme(app);
  const hostResult = useMcpToolResult<TodoToolResult>(app);
  const [result, setResult] = useState<TodoToolResult | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response: AppToolResult = await app.callServerTool({
        name: 'todos_list',
        arguments: { paginationOpts: { numItems: 20, cursor: null } },
      });
      if (response.isError || !isTodoResult(response.structuredContent)) {
        setError('The host could not load todos.');
      } else {
        setResult(response.structuredContent);
      }
    } catch {
      setError('The host could not load todos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let open = true;
    app
      .connect()
      .then(() => {
        if (open) void refresh();
      })
      .catch(() => {
        if (open) {
          setError('This view needs an MCP Apps host.');
          setLoading(false);
        }
      });
    return () => {
      open = false;
      void app.close();
    };
  }, [refresh]);

  useEffect(() => {
    if (hostResult) {
      if (isTodoResult(hostResult)) setResult(hostResult);
      else setError('The host returned an unsupported todo result.');
      setLoading(false);
    }
  }, [hostResult]);

  return (
    <div data-theme={theme}>
      <TodoList
        todos={result?.result.page ?? []}
        loading={loading}
        error={error}
        onRefresh={() => void refresh()}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<TodosMcpApp />);
