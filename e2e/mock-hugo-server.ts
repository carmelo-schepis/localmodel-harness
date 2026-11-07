import { createServer } from 'node:http';

const port = Number(process.env.MOCK_HUGO_PORT ?? 11435);
let lastRequest: Record<string, unknown> | undefined;
let scenario = 'normal';
let slowStartAborted = false;
let chatRequestCount = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); return; }
  if (req.url === '/__test/reset') { lastRequest = undefined; scenario = 'normal'; slowStartAborted = false; chatRequestCount = 0; res.writeHead(204); res.end(); return; }
  if (req.method === 'POST' && req.url === '/__test/config') { let raw='';for await (const chunk of req)raw+=chunk;scenario=(JSON.parse(raw) as {scenario?:string}).scenario??'normal';res.writeHead(204);res.end();return; }
  if (req.url === '/__test/count') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({count:chatRequestCount})); return; }
  if (req.url === '/__test/last') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(lastRequest ?? null)); return; }
  if (req.url === '/__test/slow-start-aborted') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({aborted:slowStartAborted})); return; }
  if (req.method === 'GET' && req.url === '/api/tags') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({models:[{name:'text-only:1b',size:1000000},{name:'gemma3:4b',size:4000000}]})); return; }
  if (req.method === 'GET' && req.url === '/api/ps') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({models:[]})); return; }
  if (req.method === 'POST' && req.url === '/api/show') { let raw='';for await (const chunk of req)raw+=chunk;const body=JSON.parse(raw);res.writeHead(200, {'content-type':'application/json'});res.end(JSON.stringify(body.model==='gemma3:4b'?{capabilities:['completion','vision'],model_info:{'gemma.context_length':8192}}:{capabilities:['completion'],model_info:{'text.context_length':8192}}));return; }
  if (req.method === 'POST' && req.url === '/api/chat') {
    chatRequestCount++;let raw='';for await (const chunk of req)raw+=chunk;lastRequest=JSON.parse(raw) as Record<string,unknown>;
    if (scenario === 'slow-start' || scenario === 'navigation-start') await new Promise<void>(resolve=>{const timer=setTimeout(resolve,scenario==='slow-start'?8000:750);res.once('close',()=>{if(!res.writableEnded){slowStartAborted=true;clearTimeout(timer);resolve()}})});
    if (scenario === 'duplicate-start') await new Promise(resolve=>setTimeout(resolve,700));
    if (res.destroyed) return;
    if (scenario === 'reject-start') { res.writeHead(503, {'content-type':'application/json'}); res.end('{"error":"fixture rejected startup"}'); return; }
    res.writeHead(200, {'content-type':'application/x-ndjson','cache-control':'no-cache'});
    if (scenario === 'interrupt') { res.end(`${JSON.stringify({message:{content:'Partial answer only.'},done:false})}\n`); return; }
    const content='The image has a red left half, a blue right half, and a yellow circle in the center.';
    for (const word of content.match(/.{1,14}/g)??[]) res.write(`${JSON.stringify({message:{content:word},done:false})}\n`);
    res.end(`${JSON.stringify({message:{content:''},done:true})}\n`);return;
  }
  res.writeHead(404, {'content-type':'application/json'});res.end('{"error":"not found"}');
});
server.listen(port, '127.0.0.1');
