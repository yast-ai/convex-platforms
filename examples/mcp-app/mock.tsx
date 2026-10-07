import { createRoot } from 'react-dom/client';
import { TodoList } from './TodoList.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <>
    <p>This is a browser-only mock. It does not connect to an MCP host.</p>
    <TodoList
      todos={[{ _id: 'mock-1', text: 'Verify this UI in an MCP host' }]}
      loading={false}
      error={null}
      onRefresh={() => {}}
    />
  </>,
);
