import { useEffect, useState } from 'react';

// Minimal placeholder shell for P2-T14. Full routing/dashboard arrive in
// later Phase-2 tasks. This component fetches `/api/boards` only to prove,
// at runtime, that the dev-server middleware wiring (Vite -> @easel/server)
// actually reaches the backend from the same origin — not because the app's
// real UI belongs here yet.
type BoardsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; count: number };

export default function App() {
  const [boards, setBoards] = useState<BoardsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/boards')
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ boards?: unknown[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setBoards({ status: 'ready', count: Array.isArray(data.boards) ? data.boards.length : 0 });
      })
      .catch(() => {
        if (!cancelled) setBoards({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>easel</h1>
      {boards.status === 'loading' && <p>Loading boards…</p>}
      {boards.status === 'error' && <p>Boards unavailable.</p>}
      {boards.status === 'ready' && <p>{boards.count} board(s)</p>}
    </div>
  );
}
