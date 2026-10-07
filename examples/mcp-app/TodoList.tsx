export type Todo = { _id: string; text: string };

export function TodoList({
  todos,
  loading,
  error,
  onRefresh,
}: {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <main aria-busy={loading}>
      <header>
        <h1>Todos</h1>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && todos.length === 0 ? <p>No todos yet.</p> : null}
      <ul>
        {todos.map((todo) => (
          <li key={todo._id}>{todo.text}</li>
        ))}
      </ul>
    </main>
  );
}
