import { useEffect, useState } from 'react';
import { getHealth } from '../shared/api/health';

export function App() {
  const [status, setStatus] = useState('Checking Traceability API…');

  useEffect(() => {
    getHealth().then(() => setStatus('Traceability API connected')).catch(() => setStatus('Traceability API unavailable'));
  }, []);

  return <main><h1>FSCM Traceability</h1><p>{status}</p></main>;
}
