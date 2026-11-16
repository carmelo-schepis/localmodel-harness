import { useEffect, useState, type ReactNode } from 'react';
import { Eye, GitFork, Image as ImageIcon, RotateCcw } from 'lucide-react';
import type { LocalAttachment } from './conversation-store';

function inline(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  let cursor = 0, match: RegExpExecArray | null, index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0], key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    else { const close = token.indexOf(']('); parts.push(<a key={key} href={token.slice(close + 2, -1)} target="_blank" rel="noreferrer">{token.slice(1, close)}</a>); }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function MessageBody({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [], list: string[] = [], code: string[] = [], fenced = false;
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, i) => <span key={i}>{inline(line, `p${blocks.length}-${i}`)}{i < paragraph.length - 1 && <br/>}</span>)}</p>); paragraph = []; } };
  const flushList = () => { if (list.length) { blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((line, i) => <li key={i}>{inline(line, `li${blocks.length}-${i}`)}</li>)}</ul>); list = []; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) { flushParagraph(); flushList(); if (fenced) { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code = []; } fenced = !fenced; continue; }
    if (fenced) { code.push(line); continue; }
    const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (item) { flushParagraph(); list.push(item[1]); continue; }
    flushList();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) { flushParagraph(); const level = heading[1].length; blocks.push(level === 1 ? <h3 key={`h-${blocks.length}`}>{inline(heading[2], `h${blocks.length}`)}</h3> : <h4 key={`h-${blocks.length}`}>{inline(heading[2], `h${blocks.length}`)}</h4>); continue; }
    if (!line.trim()) flushParagraph(); else paragraph.push(line);
  }
  if (fenced) blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>);
  flushParagraph(); flushList();
  return <div className="markdown-body">{blocks}</div>;
}

export function ModelReasoning({ text }: { text: string }) {
  return <details className="model-reasoning">
    <summary>Model reasoning</summary>
    <div><MessageBody text={text}/><small>Available for this session only.</small></div>
  </details>;
}

export function MessageAttachment({ attachment, onPreview, onReuse, disableReuse = false }: { attachment: LocalAttachment; onPreview: () => void; onReuse: () => void; disableReuse?: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!attachment.blob) { setUrl(''); return; } const next = URL.createObjectURL(attachment.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [attachment.blob]);
  const available = Boolean(url);
  return <div className="message-attachment" data-attachment-id={attachment.id}>
    <button className="attachment-preview" aria-label={available ? `Preview image ${attachment.name}` : `Image ${attachment.name} unavailable locally`} disabled={!available} onClick={onPreview}>
      {available ? <img src={url} alt={`Thumbnail of ${attachment.name}`}/> : <span className="attachment-missing"><ImageIcon size={20}/></span>}
    </button>
    <div className="attachment-description"><b title={attachment.name}>{attachment.name}</b><small>{formatSize(attachment.size)} · {available ? 'Image pixels stored in this browser' : 'Image pixels unavailable; attach again to use them'}</small></div>
    {available && <button className="attachment-action" disabled={disableReuse} onClick={onReuse}><RotateCcw size={14}/>Reuse image</button>}
    <button className="attachment-action" aria-label={`Preview ${attachment.name}`} disabled={!available} onClick={onPreview}><Eye size={14}/>Preview</button>
  </div>;
}

export function formatSize(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }

export function AttachmentImagePreview({ attachment }: { attachment: LocalAttachment }) { const [url,setUrl]=useState('');useEffect(()=>{if(!attachment.blob){setUrl('');return}const value=URL.createObjectURL(attachment.blob);setUrl(value);return()=>URL.revokeObjectURL(value)},[attachment.blob]);return url?<img src={url} alt={`Full preview of ${attachment.name}`}/>:null; }

export function MessageActionFork({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) { return <button className="message-action" disabled={disabled} onClick={onClick}><GitFork size={14}/>{disabled?'Saving fork…':'Fork from here'}</button>; }
