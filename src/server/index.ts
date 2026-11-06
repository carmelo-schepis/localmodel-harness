import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { endpointBases } from './ollama/urls.js';

const dataDir = process.env.DATA_DIR ?? './data';
mkdirSync(join(dataDir, 'uploads'), { recursive: true });
const db = new Database(join(dataDir, 'harness.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (project_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);`);

const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 8 } });
await app.register(fastifyStatic, { root: join(process.cwd(), 'dist'), prefix: '/' });
const timestamp = () => new Date().toISOString();
const readJson = async (res: Response) => {
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
};
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/endpoints', async () => db.prepare('SELECT * FROM endpoints ORDER BY created_at').all());
app.get('/api/endpoints/:id/models', async (req, reply) => {
  const endpoint=db.prepare('SELECT url FROM endpoints WHERE id=?').get((req.params as {id:string}).id) as {url:string}|undefined;
  if(!endpoint)return reply.code(404).send({error:'Endpoint not found.'});
  try { const tags=await readJson(await fetch(`${endpoint.url}/api/tags`,{signal:AbortSignal.timeout(10000)})) as {models:Array<{name:string;digest:string;size:number}>};return await Promise.all(tags.models.map(async model=>{try{const res=await fetch(`${endpoint.url}/api/show`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:model.name}),signal:AbortSignal.timeout(8000)});const details=res.ok?await res.json() as {capabilities?:string[];model_info?:Record<string,unknown>}:{};return {...model,capabilities:details.capabilities??[],contextLength:Number(Object.entries(details.model_info??{}).find(([k])=>k.endsWith('.context_length'))?.[1]??4096)}}catch{return {...model,capabilities:[],contextLength:4096}}}));}catch(error){return reply.code(502).send({error:error instanceof Error?error.message:'Could not refresh models.'});}
});
app.post('/api/endpoints', async (req, reply) => {
  const body = req.body as { url?: string; name?: string };
  if (!body?.url?.trim()) return reply.code(400).send({ error: 'Enter an Ollama endpoint URL.' });
  try {
    const bases = endpointBases(body.url);
    const models = await readJson(await fetch(`${bases.native}/api/tags`, { signal: AbortSignal.timeout(10000) })) as { models: Array<{ name: string; digest: string }> };
    const id = randomUUID();
    db.prepare('INSERT OR REPLACE INTO endpoints VALUES (?, ?, ?, ?)').run(id, body.name?.trim() || new URL(bases.native).host, bases.native, timestamp());
    const capabilities = await Promise.all(models.models.map(async model => {
      try { const result = await fetch(`${bases.native}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model.name }), signal: AbortSignal.timeout(10000) }); const details = result.ok ? await result.json() as { capabilities?: string[] } : {}; return { ...model, capabilities: details.capabilities ?? [] }; }
      catch { return { ...model, capabilities: [] }; }
    }));
    return { id, name: body.name?.trim() || new URL(bases.native).host, url: bases.native, models: capabilities, openai: bases.openai };
  } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : 'Connection failed.' }); }
});
app.delete('/api/endpoints/:id', async (req, reply) => { const result = db.prepare('DELETE FROM endpoints WHERE id=?').run((req.params as {id:string}).id); return reply.code(result.changes ? 204 : 404).send(); });

app.get('/api/projects', async () => db.prepare('SELECT * FROM projects ORDER BY created_at').all());
app.post('/api/projects', async req => { const { name } = req.body as {name?:string}; const p={id:randomUUID(),name:name?.trim()||'New project',created_at:timestamp()}; db.prepare('INSERT INTO projects VALUES (?,?,?)').run(p.id,p.name,p.created_at); return p; });
app.get('/api/messages/:project', async req => db.prepare('SELECT * FROM messages WHERE project_id=? ORDER BY created_at').all((req.params as {project:string}).project));

app.post('/api/chat', async (req, reply) => {
  const { endpoint, model, project, prompt, history = [], image, mode } = req.body as {endpoint:string;model:string;project:string;prompt:string;history:Array<{role:string;content:unknown}>;image?:string;mode?:string};
  if (!endpoint || !model || !project || !prompt?.trim()) return reply.code(400).send({error:'Choose a model, project, and message.'});
  const bases = endpointBases(endpoint);
  const images = image ? [image.replace(/^data:image\/[^;]+;base64,/, '')] : undefined;
  const messages = [...history, {role:'user',content:prompt,...(images?{images}:{})}];
  const upstream = await fetch(`${bases.native}/api/chat`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,stream:true,think:false,options:{num_ctx:8192}}),signal:AbortSignal.timeout(10*60*1000)});
  if (!upstream.ok || !upstream.body) return reply.code(502).send({error:'Ollama could not start this request.'});
  const id=randomUUID(), created=timestamp();
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run(randomUUID(),project,'user',prompt,model,created);
  reply.hijack();
  reply.raw.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  let complete='';
  try { const reader=upstream.body.getReader(); const decoder=new TextDecoder(); while(true){const {value,done}=await reader.read();if(done)break; for(const line of decoder.decode(value,{stream:true}).split('\n')){if(!line.trim())continue; try{const item=JSON.parse(line) as {message?:{content?:string;thinking?:string;tool_calls?:unknown[]};done?:boolean};if(item.message?.content){complete+=item.message.content;reply.raw.write(`data: ${JSON.stringify({id,delta:item.message.content})}\n\n`);}if(item.message?.tool_calls?.length)reply.raw.write(`data: ${JSON.stringify({id,error:'This model requested a tool, but no connected MCP server can handle it yet.'})}\n\n`);if(item.done)break;}catch{continue;}}} if(complete)db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run(randomUUID(),project,'assistant',complete,model,timestamp()); reply.raw.write(`data: ${JSON.stringify({id,done:true,mode})}\n\n`); } catch(error){ reply.raw.write(`data: ${JSON.stringify({id,error:error instanceof Error?error.message:'Request interrupted'})}\n\n`);} finally {reply.raw.end();}
});

app.post('/api/upload/:project', async (req, reply) => {
  const project=(req.params as {project:string}).project;
  try {
    const file=await req.file(); if(!file)return reply.code(400).send({error:'Choose a file.'});
    const buffer=await file.toBuffer(); const name=file.filename; const mime=file.mimetype;
    let content='';
    if (mime==='text/plain'||mime==='text/markdown'||mime==='text/csv'||mime==='application/json'||/\.(txt|md|csv|json|log|ndjson)$/i.test(name)) content=buffer.toString('utf8');
    else if(name.toLowerCase().endsWith('.pdf')){const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await pdf.getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);const text=await p.getTextContent();content+=`\n[Page ${n}]\n${text.items.map(x=>'str'in x?x.str:'').join(' ')}`;}}
    else if(name.toLowerCase().endsWith('.docx')){const mammoth=await import('mammoth');content=(await mammoth.extractRawText({buffer})).value;}
    else if(mime.startsWith('image/'))content=`Image attached (${mime}, ${buffer.length} bytes). Ask a vision model about the original attachment.`;
    else return reply.code(415).send({error:'Supported files: text, Markdown, CSV, JSON, logs, PDF, DOCX, and images.'});
    const id=randomUUID();db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?)').run(id,project,name,mime,content,timestamp());
    return {id,name,mime,content:content.slice(0,20000),chars:content.length};
  } catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Could not read this file.'});}
});
app.get('/api/files/:project', async req=>db.prepare('SELECT id,name,kind,content,created_at FROM files WHERE project_id=? ORDER BY created_at DESC').all((req.params as {project:string}).project));
app.post('/api/draft/:project', async req=>{const id=(req.params as {project:string}).project;const {content}=req.body as {content:string};db.prepare('INSERT INTO drafts VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at').run(id,content,timestamp());return {ok:true};});
app.get('/api/draft/:project', async req=>db.prepare('SELECT content FROM drafts WHERE project_id=?').get((req.params as {project:string}).project)??{content:''});
app.post('/api/cases/:project', async req=>{const project=(req.params as {project:string}).project;const {title,body}=req.body as {title:string;body:string};const id=randomUUID();db.prepare('INSERT INTO cases VALUES (?,?,?,?,?)').run(id,project,title,body,timestamp());return {id,title,body};});
app.get('/api/cases/:project', async req=>db.prepare('SELECT * FROM cases WHERE project_id=? ORDER BY updated_at DESC').all((req.params as {project:string}).project));
app.post('/api/search', async (req,reply)=>{const {q}=req.body as {q:string};try {const response=await fetch(`http://searxng:8080/search?q=${encodeURIComponent(q)}&format=json`,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`Search returned ${response.status}`);return await response.json();}catch{return reply.code(502).send({error:'Web search is unavailable. Check that the bundled search service is running.'});}});
app.get('/api/library/:project',async req=>db.prepare('SELECT id,name,kind,content,created_at FROM files WHERE project_id=? ORDER BY created_at DESC').all((req.params as {project:string}).project));

const port=Number(process.env.PORT??3000);
await app.listen({port,host:'0.0.0.0'});
