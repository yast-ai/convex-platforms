import { App } from '@modelcontextprotocol/ext-apps';
import { useEffect, useState } from 'react';

export type McpTheme = 'light' | 'dark';

/** Create the official MCP Apps bridge. The host owns authentication and tool execution. */
export function createMcpApp(name: string, version = '1.0.0') {
  return new App({ name, version }, {});
}

/** Keep a React widget in sync with the host's current color scheme. */
export function useMcpTheme(app: App): McpTheme {
  const readTheme = (): McpTheme => (app.getHostContext()?.theme === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState<McpTheme>(readTheme);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    app.addEventListener('hostcontextchanged', update);
    update();
    return () => app.removeEventListener('hostcontextchanged', update);
  }, [app]);
  return theme;
}

/** Receive the latest structured result forwarded by the MCP Apps host. */
export function useMcpToolResult<T = unknown>(app: App): T | undefined {
  const [result, setResult] = useState<T>();
  useEffect(() => {
    const update = (event: { structuredContent?: unknown }) =>
      setResult(event.structuredContent as T | undefined);
    app.addEventListener('toolresult', update);
    return () => app.removeEventListener('toolresult', update);
  }, [app]);
  return result;
}
