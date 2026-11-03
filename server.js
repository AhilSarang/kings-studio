import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { fal, ApiError } from '@fal-ai/client';
import { MODELS, buildRequest, estimateCost } from './public/models.js';
import { PHOTO_MODEL } from './public/ugc.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const HISTORY_FILE = path.join(OUTPUTS_DIR, 'history.json');
const ENV_FILE = path.join(ROOT, '.env');
const PORT = Number(process.env.PORT) || 3737;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

// ---------- API key ----------

function readEnvFile() {
  try {
    const env = {};
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

let falKey = process.env.FAL_KEY || readEnvFile().FAL_KEY || '';
fal.config({ credentials: falKey });
let replicateKey = process.env.REPLICATE_API_TOKEN || readEnvFile().REPLICATE_API_TOKEN || '';

// Updates keys in .env without dropping the others.
async function writeEnv(updates) {
  const merged = { ...readEnvFile(), ...updates };
  await fsp.writeFile(ENV_FILE, Object.entries(merged).map(([k, v]) => `${k}=${v}\n`).join(''), { mode: 0o600 });
}

async function saveKey(key) {
  falKey = key;
  fal.config({ credentials: key });
  await writeEnv({ FAL_KEY: key });
}

async function saveReplicateKey(key) {
  replicateKey = key;
  await writeEnv({ REPLICATE_API_TOKEN: key });
}

// ---------- History ----------

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
let jobs = [];
try {
  jobs = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch {}

let saving = Promise.resolve();
function saveHistory() {
  saving = saving.then(async () => {
    const tmp = `${HISTORY_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(jobs, null, 2));
    await fsp.rename(tmp, HISTORY_FILE);
  }).catch((err) => console.error('Could not save history:', err.message));
  return saving;
}

const isActive = (job) => job.status === 'queued' || job.status === 'running';

// ---------- fal.ai jobs ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'fal.ai rejected your API key. Paste a new one with the key button (top right).';
    const detail = err.body?.detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => [d.loc?.slice(1).join('.'), d.msg].filter(Boolean).join(': ')).join('; ');
    }
    if (typeof detail === 'string') return detail;
    if (err.status === 402 || err.status === 403) {
      return 'fal.ai refused the request. Check your balance at fal.ai/dashboard/billing.';
    }
    return err.message || `fal.ai error ${err.status}`;
  }
  return err?.message || String(err);
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

async function download(url, baseName, fallbackExt) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const ext = EXT_BY_TYPE[type] || path.extname(new URL(url).pathname).slice(1) || fallbackExt;
  const file = `${baseName}.${ext}`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path.join(OUTPUTS_DIR, file)));
  return file;
}

async function collectOutputs(job, data) {
  const items = job.kind === 'video'
    ? [{ ...data.video, type: 'video' }]
    : (data.images || []).map((img) => ({ ...img, type: 'image' }));
  const stamp = new Date(job.createdAt).toISOString().slice(0, 10);
  const outputs = [];
  for (const [i, item] of items.entries()) {
    const out = { type: item.type, remote: item.url, width: item.width, height: item.height };
    try {
      out.file = await download(item.url, `${stamp}_${job.model}_${job.id}_${i + 1}`, item.type === 'video' ? 'mp4' : 'png');
    } catch (err) {
      // Keep the fal.ai link so the result isn't lost; it just won't be saved locally.
      console.error(`Could not save ${item.url}:`, err.message);
    }
    outputs.push(out);
  }
  return outputs;
}

// ---------- Replicate jobs (Seedance 2.5 at ByteDance's direct price) ----------

const REPLICATE_API = 'https://api.replicate.com/v1';

async function replicate(pathname, init = {}, token = replicateKey) {
  const res = await fetch(`${REPLICATE_API}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 401 ? 'Replicate rejected your API token. Paste a new one with the key button (top right).'
      : res.status === 402 ? 'Replicate refused the request. Add credit at replicate.com/account/billing.'
      : body.detail || body.title || `Replicate error ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body;
}

async function trackReplicate(job) {
  let failures = 0;
  while (job.status !== 'cancelled') {
    try {
      const p = await replicate(`/predictions/${job.requestId}`);
      failures = 0;
      if (job.status === 'cancelled') return;
      if (p.status === 'succeeded') {
        const url = Array.isArray(p.output) ? p.output[0] : p.output;
        job.outputs = url ? await collectOutputs(job, { video: { url } }) : [];
        job.status = job.outputs.length ? 'done' : 'failed';
        if (!job.outputs.length) job.error = 'Replicate returned no output.';
        break;
      }
      if (p.status === 'failed' || p.status === 'canceled') {
        job.status = p.status === 'canceled' ? 'cancelled' : 'failed';
        if (p.error) job.error = String(p.error);
        break;
      }
      const status = p.status === 'starting' ? 'queued' : 'running';
      if (status !== job.status) {
        job.status = status;
        if (status === 'running' && !job.startedAt) job.startedAt = Date.now();
        saveHistory();
      }
    } catch (err) {
      // Ride out network blips and rate limits; other 4xx errors won't fix themselves.
      if ((err.status >= 400 && err.status < 500 && err.status !== 429) || ++failures > 15) {
        job.status = 'failed';
        job.error = `Lost contact with Replicate: ${err.message}`;
        break;
      }
    }
    await sleep(4000);
  }
  job.finishedAt = Date.now();
  saveHistory();
}

async function track(job) {
  if (job.provider === 'replicate') return trackReplicate(job);
  let failures = 0;
  const interval = job.kind === 'video' ? 4000 : 1500;
  while (true) {
    if (job.status === 'cancelled') return;
    try {
      const s = await fal.queue.status(job.endpoint, { requestId: job.requestId, logs: false });
      failures = 0;
      if (job.status === 'cancelled') return;
      if (s.status === 'COMPLETED') break;
      const status = s.status === 'IN_QUEUE' ? 'queued' : 'running';
      const position = s.status === 'IN_QUEUE' ? s.queue_position : undefined;
      if (status !== job.status || position !== job.queuePosition) {
        job.status = status;
        job.queuePosition = position;
        if (status === 'running' && !job.startedAt) job.startedAt = Date.now();
        saveHistory();
      }
    } catch (err) {
      // Ride out network blips and rate limits; other 4xx errors won't fix themselves.
      const permanent = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (permanent || ++failures > 15) {
        job.status = 'failed';
        job.error = `Lost contact with fal.ai: ${describeError(err)}`;
        saveHistory();
        return;
      }
    }
    await sleep(interval);
  }

  try {
    const { data } = await fal.queue.result(job.endpoint, { requestId: job.requestId });
    job.outputs = await collectOutputs(job, data);
    job.status = job.outputs.length ? 'done' : 'failed';
    if (!job.outputs.length) job.error = 'fal.ai returned no output.';
  } catch (err) {
    job.status = 'failed';
    job.error = describeError(err);
  }
  job.finishedAt = Date.now();
  saveHistory();
  if (job.status === 'done' && job.next) await chainNext(job);
}

// UGC reels: once the creator shot is done, animate it with the video settings in job.next.
async function chainNext(job) {
  const form = { ...job.next, startFrame: job.outputs[0].remote };
  try {
    job.chainedTo = (await submit(form, { ugc: true })).id;
  } catch (err) {
    jobs.unshift({
      id: crypto.randomBytes(4).toString('hex'), kind: 'video', model: form.model, prompt: form.prompt, form,
      ugc: true, cost: 0, status: 'failed', error: describeError(err), createdAt: Date.now(), outputs: [],
    });
  }
  job.next = null;
  saveHistory();
}

async function submit(form, extra = {}) {
  const { endpoint, input } = buildRequest(form);
  const model = MODELS[form.model];
  const provider = model.provider || 'fal';
  let request_id;
  if (provider === 'replicate') {
    if (!replicateKey) throw Object.assign(new Error('Add your Replicate API token first (key button, top right).'), { status: 400 });
    ({ id: request_id } = await replicate(`/models/${endpoint}/predictions`, { method: 'POST', body: JSON.stringify({ input }) }));
  } else {
    ({ request_id } = await fal.queue.submit(endpoint, { input }));
  }
  const job = {
    ...extra,
    id: crypto.randomBytes(4).toString('hex'),
    kind: model.kind,
    model: form.model,
    provider,
    endpoint,
    requestId: request_id,
    prompt: input.prompt || '',
    form,
    cost: estimateCost(form).usd,
    status: 'queued',
    createdAt: Date.now(),
    outputs: [],
  };
  jobs.unshift(job);
  await saveHistory();
  track(job);
  return job;
}

// Jobs still rendering when the server last stopped: pick them back up.
for (const job of jobs.filter(isActive)) track(job);
for (const job of jobs.filter((j) => j.status === 'done' && j.next)) chainNext(job);

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('File is too large (30 MB max).'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveFile(req, res, baseDir, relPath) {
  const filePath = path.join(baseDir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(baseDir + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error();
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    // Videos need range requests so the browser can seek.
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, {
      'content-type': type, 'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1,
    });
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' });
  fs.createReadStream(filePath).pipe(res);
}

const routes = {
  'GET /api/status': async () => ({ hasKey: Boolean(falKey), hasReplicateKey: Boolean(replicateKey) }),

  'POST /api/key': async (req) => {
    const { key } = JSON.parse(await readBody(req, 10_000));
    if (!key || typeof key !== 'string' || key.trim().length < 10) {
      throw Object.assign(new Error('That does not look like a fal.ai key.'), { status: 400 });
    }
    await saveKey(key.trim());
    return { ok: true };
  },

  // Checked against Replicate before saving, so a typo shows up here rather than on the first render.
  'POST /api/key/replicate': async (req) => {
    const { key } = JSON.parse(await readBody(req, 10_000));
    const token = typeof key === 'string' ? key.trim() : '';
    if (token.length < 20) throw Object.assign(new Error('That does not look like a Replicate API token.'), { status: 400 });
    const account = await replicate('/account', {}, token).catch((err) => {
      throw Object.assign(new Error(err.status === 401 ? 'Replicate did not accept that token.' : err.message), { status: 400 });
    });
    await saveReplicateKey(token);
    return { ok: true, username: account.username };
  },

  'GET /api/history': async () => jobs,

  // Reference images and frames go to fal.ai storage so the models can read them.
  'POST /api/upload': async (req) => {
    if (!falKey) throw Object.assign(new Error('Add your fal.ai API key first.'), { status: 400 });
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    const type = req.headers['content-type'] || 'application/octet-stream';
    const name = decodeURIComponent(req.headers['x-filename'] || 'upload');
    const url = await fal.storage.upload(new File([body], name, { type }));
    return { url };
  },

  'POST /api/generate': async (req) => {
    const form = JSON.parse(await readBody(req, 1_000_000));
    if (MODELS[form.model]?.provider !== 'replicate' && !falKey) {
      throw Object.assign(new Error('Add your fal.ai API key first.'), { status: 400 });
    }
    return submit(form);
  },

  // UGC reel = creator shot (image job) that hands off to a video job when it finishes.
  'POST /api/ugc': async (req) => {
    if (!falKey) throw Object.assign(new Error('Add your fal.ai API key first.'), { status: 400 });
    const { photo, video } = JSON.parse(await readBody(req, 1_000_000));
    if (!photo?.refs?.length) throw Object.assign(new Error('Add a photo of your product.'), { status: 400 });
    if (MODELS[video?.model]?.kind !== 'video') throw Object.assign(new Error('Pick a video model.'), { status: 400 });
    // Check the video settings now, so a bad setting doesn't cost you a photo first.
    buildRequest({ ...video, startFrame: 'https://example.com/check.png' });
    const photoForm = { model: PHOTO_MODEL, prompt: photo.prompt, aspect: '9:16', resolution: '2K', numImages: 1, refs: photo.refs };
    return submit(photoForm, { ugc: true, next: video });
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) return sendJson(res, 200, await route(req));

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)(\/cancel)?$/);
    if (jobMatch) {
      const job = jobs.find((j) => j.id === jobMatch[1]);
      if (!job) return sendJson(res, 404, { error: 'Not found' });
      if (req.method === 'POST' && jobMatch[2]) {
        if (!isActive(job)) return sendJson(res, 200, job);
        try {
          if (job.provider === 'replicate') await replicate(`/predictions/${job.requestId}/cancel`, { method: 'POST' });
          else await fal.queue.cancel(job.endpoint, { requestId: job.requestId });
        } catch {
          throw Object.assign(new Error('It has already started rendering, so it can’t be cancelled.'), { status: 409 });
        }
        job.status = 'cancelled';
        await saveHistory();
        return sendJson(res, 200, job);
      }
      if (req.method === 'DELETE' && !jobMatch[2]) {
        if (isActive(job)) throw Object.assign(new Error('Cancel it first, or wait for it to finish.'), { status: 409 });
        for (const out of job.outputs || []) {
          if (out.file) await fsp.rm(path.join(OUTPUTS_DIR, out.file), { force: true });
        }
        jobs = jobs.filter((j) => j !== job);
        await saveHistory();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/outputs/')) {
      return serveFile(req, res, OUTPUTS_DIR, decodeURIComponent(url.pathname.slice('/outputs/'.length)));
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      return serveFile(req, res, PUBLIC_DIR, rel);
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err.status && err.status < 500 ? err.status : 500;
    sendJson(res, status, { error: describeError(err) });
  }
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.log(`\n  Kings Studio is already running → http://localhost:${PORT}\n  Use that browser tab, or close the other Terminal window first.\n`);
  process.exit(0);
});

// Bound to this computer only, so nobody on your Wi-Fi can spend your credits.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Kings Studio is running → http://localhost:${PORT}\n`);
  if (!falKey) console.log('  No fal.ai key yet. The app will ask for one.\n');
});
