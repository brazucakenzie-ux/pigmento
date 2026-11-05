import { createRoot } from 'react-dom/client';

function Boot() {
  return <div style={{ padding: 24, fontFamily: 'sans-serif' }}>Pigmento is starting…</div>;
}

createRoot(document.getElementById('root')!).render(<Boot />);
