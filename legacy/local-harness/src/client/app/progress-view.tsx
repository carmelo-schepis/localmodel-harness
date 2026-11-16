import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export function ProgressView({ lines, startedAt }: { lines: string[]; startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!lines.length) return null;
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return <div className="request-progress" role="status" aria-live="polite" aria-atomic="false">
    <div className="progress-lines" aria-hidden="true">{lines.slice(-3).map((line, index) => <div className={`progress-line progress-line-${index}`} key={`${line}-${index}`}>{index === lines.slice(-3).length - 1 && <LoaderCircle className="spin" size={13}/>}<span>{line}</span></div>)}</div>
    <span className="progress-live">{lines.at(-1)}{elapsed > 8 ? ` · ${elapsed}s` : ''}</span>
    {elapsed > 8 && <span className="progress-elapsed" aria-hidden="true">{elapsed}s</span>}
  </div>;
}
