import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TodoList } from './TodoList.js';

function MockTodoList() {
  const [loading, setLoading] = useState(false);
  const [todos, setTodos] = useState([
    { _id: 'mock-1', text: 'Verify this UI in an MCP host' },
  ]);
  const [status, setStatus] = useState('Ready to refresh the example data.');
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    };
  }, []);

  const refresh = () => {
    setLoading(true);
    setStatus('Refreshing example data.');
    refreshTimer.current = window.setTimeout(() => {
      setTodos([
        { _id: 'mock-1', text: 'Verify this UI in an MCP host' },
        { _id: 'mock-2', text: 'Refresh updates this browser-only state' },
      ]);
      setLoading(false);
      setStatus('Example data refreshed.');
    }, 500);
  };

  return (
    <div data-theme="light">
      <p className="mock-notice">
        <strong>Browser-only mock.</strong> It does not connect to an MCP host.
      </p>
      <p className="mock-status" role="status" aria-live="polite">
        {status}
      </p>
      <TodoList todos={todos} loading={loading} error={null} onRefresh={refresh} />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<MockTodoList />);
