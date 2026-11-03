import { MODELS, modelsOfKind, estimateCost, formatUsd, validDuration } from '/models.js';
import { PHOTO_MODEL, CREATORS, SETTINGS, FORMATS, scriptIdea, speechSeconds, photoPrompt, videoPrompt } from '/ugc.js';

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids.flat().filter((kid) => kid != null && kid !== false));
  return node;
}

async function api(path, { method = 'GET', json, blob, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: json ? { 'content-type': 'application/json' } : headers,
    body: json ? JSON.stringify(json) : blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2600);
}

// ---------- Preferences (remembered in this browser) ----------

const STORE_KEY = 'kings-studio:v1';
const defaultUgc = () => ({
  model: 'wan-3.0', res: {}, creator: CREATORS[0], setting: 'bathroom', format: 'talking',
  name: '', benefit: '', script: '', idea: 0,
});
const defaultPrefs = () => ({
  tab: 'image', imageModel: 'flux-3', videoModel: 'wan-3.0', prompts: { image: '', video: '' }, settings: {}, ugc: defaultUgc(),
});
let prefs;
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  prefs = { ...defaultPrefs(), ...saved, ugc: { ...defaultUgc(), ...saved.ugc } };
} catch {
  prefs = defaultPrefs();
}
if (MODELS[prefs.imageModel]?.kind !== 'image') prefs.imageModel = 'flux-3';
if (MODELS[prefs.videoModel]?.kind !== 'video') prefs.videoModel = 'wan-3.0';
if (MODELS[prefs.ugc.model]?.kind !== 'video') prefs.ugc.model = 'wan-3.0';
if (!['image', 'video', 'ugc'].includes(prefs.tab)) prefs.tab = 'image';
const persist = () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch {}
};

function settingsFor(id) {
  const m = MODELS[id];
  const s = (prefs.settings[id] ||= {});
  if (!m.aspects.includes(s.aspect)) s.aspect = m.defaultAspect;
  if (!m.resolutions.some((r) => r.value === s.resolution)) s.resolution = m.defaultResolution;
  if (m.maxImages) s.numImages = Math.min(m.maxImages, Math.max(1, s.numImages || 1));
  if (m.kind === 'video') {
    s.duration = validDuration(m, s.duration ?? String(m.duration.default));
    if (typeof s.audio !== 'boolean') s.audio = true;
  }
  return s;
}

// ---------- State ----------

const state = {
  refs: [],          // image tab: [{ id, preview, url, uploading }]
  videoRefs: [],     // video tab: product photos for reference-to-video
  startFrame: null,  // video tab
  endFrame: null,
  ugcProduct: [],    // UGC tab: product photos
  ugcFace: null,     // UGC tab: optional creator photo
  jobs: [],
  filter: 'all',
  submitting: false,
  hasKey: true,
  hasReplicateKey: true,
};

const promptEl = $('#prompt');
const modelId = () => ({ image: prefs.imageModel, video: prefs.videoModel, ugc: prefs.ugc.model })[prefs.tab];
const model = () => MODELS[modelId()];
const isActive = (job) => job.status === 'queued' || job.status === 'running';
// A finished creator shot with `next` set is about to hand off to its video.
const hasPendingWork = () => state.jobs.some((j) => isActive(j) || (j.status === 'done' && j.next));
const mediaUrl = (out) => (out.file ? `/outputs/${encodeURIComponent(out.file)}` : out.remote);
const uploading = () => [...state.refs, ...state.videoRefs, state.startFrame, state.endFrame, ...state.ugcProduct, state.ugcFace]
  .some((m) => m?.uploading);
const refsKey = () => (prefs.tab === 'video' ? 'videoRefs' : 'refs');

function currentForm() {
  const id = modelId();
  const s = settingsFor(id);
  const form = { model: id, prompt: promptEl.value.trim(), aspect: s.aspect, resolution: s.resolution };
  if (MODELS[id].kind === 'image') {
    form.numImages = s.numImages;
    form.refs = state.refs.map((r) => r.url).filter(Boolean);
  } else {
    form.duration = s.duration;
    form.audio = s.audio;
    if (MODELS[id].maxRefs) form.refs = state.videoRefs.map((r) => r.url).filter(Boolean);
    if (state.startFrame?.url) {
      form.startFrame = state.startFrame.url;
      if (state.endFrame?.url) form.endFrame = state.endFrame.url;
    }
  }
  return form;
}

// ---------- Left panel ----------

function renderTabs() {
  const tab = prefs.tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const id of ['modelBlock', 'promptBlock', 'settings']) $(`#${id}`).hidden = tab === 'ugc';
  $('#refsBlock').hidden = !(tab === 'image' || (tab === 'video' && model().maxRefs));
  $('#framesBlock').hidden = tab !== 'video';
  $('#ugcPanel').hidden = tab !== 'ugc';
}

function renderModels() {
  const list = $('#modelList');
  list.replaceChildren(...modelsOfKind(prefs.tab).map((id) => {
    const m = MODELS[id];
    return el('button', {
      class: 'model', 'aria-pressed': String(id === modelId()),
      onclick: () => { prefs[m.kind === 'image' ? 'imageModel' : 'videoModel'] = id; persist(); renderAll(); },
    },
      el('span', { class: 'model-name' }, m.label, el('span', { class: 'model-vendor', text: m.vendor })),
      el('span', { class: 'model-price', text: m.price }),
      el('span', { class: 'model-tag', text: m.tagline }),
    );
  }));
}

function renderPlaceholder() {
  if (prefs.tab === 'image') {
    promptEl.placeholder = state.refs.length
      ? 'Describe the change. E.g. "Put this bottle on a sunlit beach at golden hour. Keep the label exactly the same."'
      : 'Describe the image. E.g. "Amber perfume bottle on wet black marble, soft studio light, water droplets, 85mm product shot."';
  } else {
    promptEl.placeholder = state.startFrame
      ? `Describe how the image should move${model().promptRequired ? '' : ' (optional)'}. E.g. "Slow push-in as mist swirls around the bottle."`
      : state.videoRefs.length
        ? 'Describe the video and point at your photos. E.g. "Hands hold the pouch from Image 1 up to the camera…"'
        : 'Describe the scene and the motion. E.g. "Slow dolly-in on a perfume bottle as mist swirls around it, golden hour light, soft piano."';
  }
}

function mediaThumb(item, onRemove, cls = 'thumb') {
  return el('div', { class: `${cls}${item.uploading ? ' uploading' : ''}` },
    el('img', { src: item.preview, alt: '' }),
    el('button', { class: 'remove', 'aria-label': 'Remove', text: '✕', onclick: (e) => { e.stopPropagation(); onRemove(); } }),
  );
}

function renderRefs() {
  const m = model();
  if (!m.maxRefs) return;
  const key = refsKey();
  state[key] = state[key].slice(0, m.maxRefs);
  const refs = state[key];
  const tiles = refs.map((r) => mediaThumb(r, () => {
    state[key] = state[key].filter((x) => x !== r);
    renderMedia();
  }));
  if (refs.length < m.maxRefs) {
    tiles.push(el('button', { class: 'add-tile', onclick: () => pickFile(key) },
      el('span', { class: 'plus', text: '+' }), el('span', { text: 'Add' })));
  }
  $('#refs').replaceChildren(...tiles);
  if (m.kind === 'image') {
    $('#refsHint').textContent = refs.length ? `Edit mode · ${refs.length}/${m.maxRefs}` : 'optional · edit, restyle or combine';
  } else {
    $('#refsHint').textContent = state.startFrame && refs.length ? 'not used while a start frame is set'
      : refs.length ? `Image 1–${refs.length} in your prompt` : 'optional · product photos to match';
  }
}

function renderFrames() {
  document.querySelectorAll('.frame-slot').forEach((slot) => {
    const key = slot.dataset.slot;
    const item = state[key];
    const caption = key === 'startFrame' ? 'Start frame' : 'End frame';
    const disabled = key === 'endFrame' && !state.startFrame;
    slot.className = `frame-slot${item ? '' : ' empty'}${item?.uploading ? ' uploading' : ''}${disabled ? ' disabled' : ''}`;
    if (item) {
      slot.replaceChildren(
        el('img', { src: item.preview, alt: '' }),
        el('span', { class: 'frame-caption', text: caption }),
        el('button', { class: 'remove', 'aria-label': 'Remove', text: '✕', onclick: (e) => {
          e.stopPropagation();
          state[key] = null;
          if (key === 'startFrame') state.endFrame = null;
          renderMedia();
        } }),
      );
    } else {
      slot.replaceChildren(el('span', { class: 'plus', text: '+' }), el('span', { text: caption }),
        el('span', { class: 'hint', text: key === 'endFrame' ? 'where it ends' : 'drop or paste' }));
    }
  });
}

function chips(options, current, onPick, disabled = false) {
  return el('div', { class: 'chips' }, options.map(({ value, label }) => el('button', {
    class: 'chip', 'aria-pressed': String(value === current), disabled,
    onclick: () => onPick(value), text: label,
  })));
}

function setting(label, control, side) {
  return el('div', { class: 'setting' },
    el('div', { class: 'setting-head' }, el('span', { class: 'label', text: label }), side), control);
}

function renderSettings() {
  const id = modelId();
  const m = MODELS[id];
  const s = settingsFor(id);
  const update = (patch) => { Object.assign(s, patch); persist(); renderSettings(); updateCost(); };
  const aspectOpts = m.aspects.map((a) => ({ value: a, label: a === 'auto' ? 'Auto' : a }));
  const nodes = [];

  if (m.kind === 'image') {
    nodes.push(setting('Aspect ratio', chips(aspectOpts, s.aspect, (v) => update({ aspect: v }))));
    nodes.push(setting('Resolution', chips(m.resolutions, s.resolution, (v) => update({ resolution: v }))));
    if (m.maxImages > 1) {
      const counts = Array.from({ length: m.maxImages }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
      nodes.push(setting('Images', chips(counts, s.numImages, (v) => update({ numImages: v }))));
    }
  } else {
    const fromImage = Boolean(state.startFrame);
    nodes.push(setting('Aspect ratio', chips(aspectOpts, fromImage ? 'auto' : s.aspect, (v) => update({ aspect: v }), fromImage)));
    if (fromImage) nodes.push(el('p', { class: 'note', text: 'The clip matches your start frame’s shape.' }));
    nodes.push(setting('Resolution', chips(m.resolutions, s.resolution, (v) => update({ resolution: v }))));

    const auto = s.duration === 'auto';
    const lastLength = Number(validDuration(m, s.lastLength ?? m.duration.default));
    const slider = el('input', {
      type: 'range', min: m.duration.min, max: m.duration.max, step: 1, value: auto ? lastLength : s.duration, disabled: auto,
      'aria-label': 'Duration in seconds',
      oninput: (e) => { valueEl.textContent = `${e.target.value}s`; },
      onchange: (e) => update({ duration: e.target.value, lastLength: e.target.value }),
    });
    const valueEl = el('span', { class: 'value', text: auto ? 'Auto' : `${s.duration}s` });
    nodes.push(setting('Duration', el('div', { class: 'slider-row' }, slider, valueEl)));
    if (m.duration.auto) {
      nodes.push(toggle('Let the model pick the length', auto, (on) =>
        update(on ? { duration: 'auto', lastLength: s.duration } : { duration: String(lastLength) })));
    }
    if (m.audioToggle) nodes.push(toggle('Native audio (voices, SFX, music)', s.audio, (on) => update({ audio: on })));
    else nodes.push(el('p', { class: 'note', text: `${m.label} always generates audio with the video.` }));
  }
  $('#settings').replaceChildren(...nodes);
}

function toggle(label, checked, onChange) {
  return el('label', { class: 'toggle' },
    el('span', { class: 'hint', style: 'color: var(--muted); font-size: 13px', text: label }),
    el('span', { class: 'switch' },
      el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
      el('span')));
}

function updateCost() {
  let usd, note;
  if (prefs.tab === 'ugc') {
    const { photo, video } = ugcForms();
    usd = estimateCost(photo).usd + estimateCost({ ...video, startFrame: 'x' }).usd;
  } else {
    ({ usd, note } = estimateCost(currentForm()));
  }
  $('#cost').textContent = `≈ ${formatUsd(usd)}${note ? ` ${note}` : ''}`;
  $('#generateBtn').disabled = state.submitting || uploading();
  $('#generateBtn span').textContent = state.submitting ? 'Sending…' : uploading() ? 'Uploading…'
    : prefs.tab === 'ugc' ? 'Make reel' : 'Generate';
}

// ---------- UGC tab ----------

function ugcSeconds() {
  const m = MODELS[prefs.ugc.model];
  const wanted = speechSeconds(prefs.ugc.script);
  return { wanted, seconds: Math.min(m.duration.max, Math.max(m.duration.min, wanted || m.duration.default)) };
}

function ugcResolution() {
  const m = MODELS[prefs.ugc.model];
  const r = prefs.ugc.res[prefs.ugc.model];
  return m.resolutions.some((x) => x.value === r) ? r : m.defaultResolution;
}

// Builds both halves of a reel: the creator shot and the talking video.
function ugcForms() {
  const u = prefs.ugc;
  const products = state.ugcProduct.map((p) => p.url).filter(Boolean);
  const face = state.ugcFace?.url;
  const photo = {
    model: PHOTO_MODEL, aspect: '9:16', resolution: '2K', numImages: 1,
    refs: face ? [...products, face] : products,
    prompt: photoPrompt({ creator: u.creator.trim(), setting: u.setting, format: u.format, productCount: products.length, hasFace: Boolean(face) }),
  };
  const video = {
    model: u.model, aspect: '9:16', resolution: ugcResolution(), audio: true, exactPrompt: true,
    duration: String(ugcSeconds().seconds),
    prompt: videoPrompt({ format: u.format, script: u.script }),
  };
  return { photo, video, products };
}

function renderUgc() {
  const u = prefs.ugc;
  const save = (patch) => { Object.assign(u, patch); persist(); renderUgc(); updateCost(); };

  const tiles = state.ugcProduct.map((p) => mediaThumb(p, () => {
    state.ugcProduct = state.ugcProduct.filter((x) => x !== p);
    renderUgc();
    updateCost();
  }));
  if (state.ugcProduct.length < 3) {
    tiles.push(el('button', { class: 'add-tile', onclick: () => pickFile('ugcProduct') },
      el('span', { class: 'plus', text: '+' }), el('span', { text: 'Product' })));
  }
  $('#ugcProduct').replaceChildren(...tiles);

  $('#ugcFace').replaceChildren(state.ugcFace
    ? mediaThumb(state.ugcFace, () => { state.ugcFace = null; renderUgc(); updateCost(); }, 'thumb face-slot')
    : el('button', { class: 'add-tile face-slot', title: 'Add a photo of your creator to keep the same face in every reel', onclick: () => pickFile('ugcFace') },
      el('span', { class: 'plus', text: '+' }), el('span', { text: 'Face' })));
  $('#ugcCreator').placeholder = state.ugcFace
    ? 'Optional extra details, e.g. wearing a gray hoodie'
    : 'Describe them, e.g. Latina woman, 25, curly hair, gold hoops';

  const creatorChips = CREATORS.map((c) => ({ value: c, label: c }));
  $('#ugcCreatorChips').replaceChildren(chips(creatorChips, u.creator, (c) => { $('#ugcCreator').value = c; save({ creator: c }); }));
  $('#ugcSetting').replaceChildren(chips(Object.entries(SETTINGS).map(([value, s]) => ({ value, label: s.label })), u.setting, (v) => save({ setting: v })));
  $('#ugcFormat').replaceChildren(chips(Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label })), u.format, (v) => save({ format: v })));

  $('#ugcModel').replaceChildren(...modelsOfKind('video').map((id) => {
    const m = MODELS[id];
    return el('button', { class: 'model compact', 'aria-pressed': String(id === u.model), onclick: () => save({ model: id }) },
      el('span', { class: 'model-name' }, m.label, el('span', { class: 'model-vendor', text: `up to ${m.duration.max}s` })),
      el('span', { class: 'model-price', text: m.price }));
  }));
  $('#ugcRes').replaceChildren(chips(MODELS[u.model].resolutions, ugcResolution(), (v) => save({ res: { ...u.res, [u.model]: v } })));

  const m = MODELS[u.model];
  const { wanted, seconds } = ugcSeconds();
  const info = $('#ugcScriptInfo');
  info.style.color = wanted > m.duration.max ? 'var(--danger)' : '';
  info.textContent = !wanted ? `Each reel is a 9:16 video with the creator saying this line.`
    : wanted > m.duration.max ? `Too long for ${m.label} (${m.duration.max}s max). Shorten it or pick Wan 3.0 (30s).`
    : `≈ ${seconds}s reel`;
}

function renderMedia() {
  if (prefs.tab === 'ugc') {
    renderUgc();
    updateCost();
    return;
  }
  renderRefs();
  renderFrames();
  renderPlaceholder();
  renderSettings();
  updateCost();
}

function renderAll() {
  renderTabs();
  renderModels();
  promptEl.value = prefs.prompts[prefs.tab] || '';
  renderMedia();
  $('#formError').textContent = '';
}

// ---------- Uploads ----------

async function addMedia(file, target) {
  if (!file?.type?.startsWith('image/')) return toast('Only PNG, JPG or WebP images work here.', true);
  const item = { id: Math.random().toString(36).slice(2), preview: URL.createObjectURL(file), url: null, uploading: true };
  const isList = Array.isArray(state[target]);
  if (isList) {
    const isRefs = target === 'refs' || target === 'videoRefs';
    const max = isRefs ? model().maxRefs : 3;
    if (state[target].length >= max) return toast(isRefs ? `${model().label} takes up to ${max} references.` : `Up to ${max} product photos.`, true);
    state[target].push(item);
  } else {
    state[target] = item;
  }
  renderMedia();
  try {
    const { url } = await api('/api/upload', {
      method: 'POST', blob: file,
      headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name || 'image.png') },
    });
    item.url = url;
  } catch (err) {
    if (isList) state[target] = state[target].filter((r) => r !== item);
    else if (state[target] === item) state[target] = null;
    toast(`Upload failed: ${err.message}`, true);
    if (/api key/i.test(err.message)) openKeyDialog();
  }
  item.uploading = false;
  renderMedia();
}

async function addFromUrl(url, target, name = 'image.png') {
  const blob = await (await fetch(url)).blob();
  return addMedia(new File([blob], name, { type: blob.type || 'image/png' }), target);
}

function pickFile(target) {
  const input = $('#fileInput');
  input.multiple = Array.isArray(state[target]);
  input.onchange = () => {
    for (const file of input.files) addMedia(file, target);
    input.value = '';
  };
  input.click();
}

function makeDropZone(node, getTarget) {
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drag-over'); });
  node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) addMedia(file, getTarget());
  });
}

// ---------- Generate ----------

async function generateUgc() {
  const errorEl = $('#formError');
  errorEl.textContent = '';
  const { photo, video, products } = ugcForms();
  const m = MODELS[video.model];
  const { wanted } = ugcSeconds();
  const problem = !products.length ? 'Add at least one photo of your product.'
    : !prefs.ugc.script.trim() ? 'Write what the creator says (or tap Script idea).'
    : wanted > m.duration.max ? `That script is too long for ${m.label}. Shorten it or pick Wan 3.0.`
    : '';
  if (problem) {
    errorEl.textContent = problem;
    return;
  }
  if (!state.hasKey) return openKeyDialog();
  if (m.provider === 'replicate' && !state.hasReplicateKey) return openReplicateDialog();
  state.submitting = true;
  updateCost();
  try {
    const job = await api('/api/ugc', { method: 'POST', json: { photo, video } });
    state.jobs.unshift(job);
    renderGallery();
    startPolling();
    toast('Making the creator shot first, then the video starts automatically');
  } catch (err) {
    errorEl.textContent = err.message;
    if (/api key/i.test(err.message)) openKeyDialog();
  } finally {
    state.submitting = false;
    updateCost();
  }
}

async function generate() {
  if (state.submitting || uploading()) return;
  if (prefs.tab === 'ugc') return generateUgc();
  const form = currentForm();
  const errorEl = $('#formError');
  errorEl.textContent = '';
  const m = model();
  if (!form.prompt && (m.kind === 'image' || m.promptRequired || !form.startFrame)) {
    errorEl.textContent = m.kind === 'image' ? 'Write a prompt first.'
      : m.promptRequired ? `${m.label} needs a prompt describing the motion.`
      : 'Write a prompt, or add a start frame to animate.';
    promptEl.focus();
    return;
  }
  if (m.provider === 'replicate' ? !state.hasReplicateKey : !state.hasKey) {
    return m.provider === 'replicate' ? openReplicateDialog() : openKeyDialog();
  }
  state.submitting = true;
  updateCost();
  try {
    const job = await api('/api/generate', { method: 'POST', json: form });
    state.jobs.unshift(job);
    renderGallery();
    startPolling();
  } catch (err) {
    errorEl.textContent = err.message;
    if (/replicate.*token/i.test(err.message)) openReplicateDialog();
    else if (/api key/i.test(err.message)) openKeyDialog();
  } finally {
    state.submitting = false;
    updateCost();
  }
}

// ---------- Gallery ----------

const ratio = (aspect) => (aspect && aspect !== 'auto' ? aspect.replace(':', ' / ') : '1 / 1');
const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function pendingText(job) {
  if (job.status === 'running') return 'Generating…';
  return job.queuePosition > 0 ? `In line · ${job.queuePosition} ahead` : 'Starting…';
}

function pendingCard(job) {
  const label = MODELS[job.model]?.label || job.model;
  return el('div', { class: 'card pending', style: `aspect-ratio: ${ratio(job.form?.startFrame ? 'auto' : job.form?.aspect)}` },
    el('span', { class: 'status', 'data-status': job.id, text: pendingText(job) }),
    el('span', { class: 'sub', 'data-elapsed': job.id, text: `${label} · ${fmtElapsed(Date.now() - job.createdAt)}` }),
    job.next && el('span', { class: 'sub', text: `Creator shot first, then the video with ${MODELS[job.next.model]?.label || 'your video model'}` }),
    job.kind === 'video' && el('span', { class: 'sub', text: 'Videos take a few minutes' }),
    job.status === 'queued' && el('button', { class: 'mini', text: 'Cancel', onclick: () => cancelJob(job) }),
  );
}

function failedCard(job) {
  return el('div', { class: 'card failed' },
    el('strong', { text: `${MODELS[job.model]?.label || job.model} failed` }),
    el('span', { class: 'err', text: job.error || 'Something went wrong.' }),
    job.prompt && el('span', { class: 'prompt-line', text: job.prompt }),
    el('div', { class: 'row' },
      el('button', { class: 'mini', text: 'Retry', onclick: () => retry(job) }),
      el('button', { class: 'mini', text: 'Edit', onclick: () => reuse(job) }),
      el('button', { class: 'mini', text: 'Dismiss', onclick: () => removeJob(job, false) })),
  );
}

function outputCard(job, out, i) {
  const label = MODELS[job.model]?.label || job.model;
  const src = mediaUrl(out);
  const media = out.type === 'video'
    ? el('video', { src: `${src}#t=0.1`, muted: true, loop: true, playsinline: true, preload: 'metadata' })
    : el('img', { src, alt: job.prompt, loading: 'lazy', width: out.width, height: out.height });
  const card = el('button', { class: 'card', onclick: () => openViewer(job.id, i), title: job.prompt },
    media,
    el('span', { class: 'badge', text: job.ugc ? `UGC · ${label}` : label }),
    out.type === 'video' && el('span', { class: 'badge right', text: job.form?.duration === 'auto' ? '▶' : `▶ ${job.form?.duration}s` }),
  );
  if (out.type === 'video') {
    media.muted = true;
    card.addEventListener('mouseenter', () => media.play().catch(() => {}));
    card.addEventListener('mouseleave', () => { media.pause(); media.currentTime = 0.1; });
  }
  return card;
}

const visibleJobs = () => state.jobs.filter((j) => j.status !== 'cancelled'
  && (state.filter === 'all' || (state.filter === 'ugc' ? j.ugc : j.kind === state.filter)));

let gallerySig = '';
function renderGallery(force = false) {
  const jobs = visibleJobs();
  const sig = state.filter + jobs.map((j) => `${j.id}:${j.status}:${j.outputs?.length || 0}`).join('|');
  if (sig === gallerySig && !force) return;
  gallerySig = sig;
  const cards = [];
  for (const job of jobs) {
    if (isActive(job)) cards.push(pendingCard(job));
    else if (job.status === 'failed') cards.push(failedCard(job));
    else (job.outputs || []).forEach((out, i) => cards.push(outputCard(job, out, i)));
  }
  $('#gallery').replaceChildren(...cards);
  $('#empty').hidden = cards.length > 0;
  const done = jobs.filter((j) => j.status === 'done').length;
  $('#count').textContent = done ? `${done} generation${done === 1 ? '' : 's'}` : '';
  renderSpend();
}

function renderSpend() {
  const now = new Date();
  const total = state.jobs
    .filter((j) => j.status === 'done')
    .filter((j) => { const d = new Date(j.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((sum, j) => sum + (j.cost || 0), 0);
  $('#spend').textContent = `This month ≈ $${total.toFixed(2)}`;
}

// Live clocks and queue positions without re-rendering the grid.
setInterval(() => {
  for (const job of state.jobs.filter(isActive)) {
    const status = document.querySelector(`[data-status="${job.id}"]`);
    const elapsed = document.querySelector(`[data-elapsed="${job.id}"]`);
    if (status) status.textContent = pendingText(job);
    if (elapsed) elapsed.textContent = `${MODELS[job.model]?.label || job.model} · ${fmtElapsed(Date.now() - job.createdAt)}`;
  }
}, 1000);

let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const before = new Map(state.jobs.map((j) => [j.id, j.status]));
      state.jobs = await api('/api/history');
      for (const job of state.jobs) {
        const was = before.get(job.id);
        if (was && was !== job.status && (was === 'queued' || was === 'running')) {
          const label = MODELS[job.model]?.label || job.model;
          if (job.status === 'done') toast(job.ugc && job.kind === 'image' ? 'Creator shot ready. Now making the video…' : `${label} finished`);
          if (job.status === 'failed') toast(`${label} failed: ${job.error}`, true);
        }
      }
      renderGallery();
    } catch {}
    if (!hasPendingWork()) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 2000);
}

async function loadHistory() {
  try {
    state.jobs = await api('/api/history');
  } catch (err) {
    toast(`Couldn't load history: ${err.message}`, true);
  }
  renderGallery(true);
  if (hasPendingWork()) startPolling();
}

// ---------- Job actions ----------

async function cancelJob(job) {
  try {
    await api(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    state.jobs = state.jobs.filter((j) => j !== job);
    renderGallery();
    toast('Cancelled');
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeJob(job, ask = true) {
  if (ask && !confirm('Delete this generation? The file is removed from the outputs folder too.')) return false;
  try {
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    state.jobs = state.jobs.filter((j) => j !== job);
    renderGallery();
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function retry(job) {
  try {
    // A failed creator shot retries the whole reel; anything else retries just itself.
    const fresh = job.next
      ? await api('/api/ugc', { method: 'POST', json: { photo: { prompt: job.form.prompt, refs: job.form.refs }, video: job.next } })
      : await api('/api/generate', { method: 'POST', json: job.form });
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    state.jobs = [fresh, ...state.jobs.filter((j) => j !== job)];
    renderGallery();
    startPolling();
  } catch (err) {
    toast(err.message, true);
  }
}

const remoteItem = (url) => (url ? { id: Math.random().toString(36).slice(2), preview: url, url, uploading: false } : null);

function reuse(job) {
  const f = job.form || {};
  prefs.prompts[prefs.tab] = promptEl.value;
  prefs.tab = job.kind;
  if (MODELS[f.model]) prefs[job.kind === 'image' ? 'imageModel' : 'videoModel'] = f.model;
  const s = settingsFor(f.model);
  for (const key of ['aspect', 'resolution', 'numImages', 'duration', 'audio']) if (f[key] !== undefined) s[key] = f[key];
  prefs.prompts[job.kind] = f.prompt || '';
  if (job.kind === 'image') {
    state.refs = (f.refs || []).map(remoteItem);
  } else if (!f.startFrame && f.refs?.length) {
    state.videoRefs = f.refs.map(remoteItem);
    state.startFrame = state.endFrame = null;
  } else {
    state.startFrame = remoteItem(f.startFrame);
    state.endFrame = remoteItem(f.endFrame);
  }
  persist();
  renderAll();
  $('#viewer').close();
  promptEl.focus();
}

function switchTab(tab) {
  if (tab === prefs.tab) return;
  prefs.prompts[prefs.tab] = promptEl.value;
  prefs.tab = tab;
  persist();
  renderAll();
}

// ---------- Viewer ----------

let viewerItems = [];
let viewerIndex = 0;

function openViewer(jobId, outIndex) {
  viewerItems = visibleJobs()
    .filter((j) => j.status === 'done')
    .flatMap((job) => (job.outputs || []).map((out, i) => ({ job, out, i })));
  viewerIndex = Math.max(0, viewerItems.findIndex((v) => v.job.id === jobId && v.i === outIndex));
  showViewerItem();
  const dialog = $('#viewer');
  if (!dialog.open) dialog.showModal();
}

function showViewerItem() {
  const item = viewerItems[viewerIndex];
  if (!item) return $('#viewer').close();
  const { job, out } = item;
  const f = job.form || {};
  const m = MODELS[job.model];
  const src = mediaUrl(out);

  $('#viewerMedia').replaceChildren(out.type === 'video'
    ? el('video', { src, controls: true, autoplay: true, loop: true, playsinline: true })
    : el('img', { src, alt: job.prompt }));
  $('#viewerModel').textContent = m?.label || job.model;
  $('#viewerMeta').textContent = `${new Date(job.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ≈ ${formatUsd(job.cost || 0)}`;
  $('#viewerPrompt').textContent = job.prompt || '(no prompt)';

  const res = m?.resolutions.find((r) => r.value === f.resolution)?.label || f.resolution;
  const tags = [
    out.width && out.height ? `${out.width}×${out.height}` : res,
    f.startFrame ? 'From image' : f.aspect,
    job.kind === 'video' && (f.duration === 'auto' ? 'Auto length' : `${f.duration}s`),
    job.kind === 'video' && res,
    job.kind === 'video' && (f.audio === false ? 'No audio' : 'Audio'),
    f.refs?.length && `${f.refs.length} reference${f.refs.length > 1 ? 's' : ''}`,
  ].filter(Boolean);
  $('#viewerTags').replaceChildren(...tags.map((t) => el('span', { class: 'tag', text: t })));

  const actions = [];
  if (out.type === 'image') {
    actions.push(el('button', { class: 'action primary', text: `Animate with ${MODELS[prefs.videoModel].label}`, onclick: () => {
      $('#viewer').close();
      switchTab('video');
      state.endFrame = null;
      addFromUrl(src, 'startFrame', out.file);
    } }));
    actions.push(el('button', { class: 'action', text: 'Use as reference', onclick: () => {
      $('#viewer').close();
      switchTab('image');
      addFromUrl(src, 'refs', out.file);
    } }));
    actions.push(el('button', { class: 'action', text: 'Use this person in UGC reels', onclick: () => {
      $('#viewer').close();
      switchTab('ugc');
      addFromUrl(src, 'ugcFace', out.file);
      toast('Added as the creator face. New reels will use this person.');
    } }));
  }
  actions.push(el('button', { class: 'action', text: 'Reuse prompt & settings', onclick: () => reuse(job) }));
  actions.push(el('a', { class: 'action', href: src, download: out.file || '', text: 'Download' }));
  actions.push(el('button', { class: 'action', text: 'Copy prompt', onclick: async () => {
    try { await navigator.clipboard.writeText(job.prompt || ''); toast('Prompt copied'); } catch { toast('Couldn’t copy', true); }
  } }));
  actions.push(el('button', { class: 'action danger', text: 'Delete', onclick: async () => {
    if (await removeJob(job)) {
      viewerItems = viewerItems.filter((v) => v.job !== job);
      viewerIndex = Math.min(viewerIndex, viewerItems.length - 1);
      showViewerItem();
    }
  } }));
  $('#viewerActions').replaceChildren(...actions);
  $('#prevBtn').hidden = viewerIndex <= 0;
  $('#nextBtn').hidden = viewerIndex >= viewerItems.length - 1;
}

function stepViewer(delta) {
  const next = viewerIndex + delta;
  if (next < 0 || next >= viewerItems.length) return;
  viewerIndex = next;
  showViewerItem();
}

// ---------- API key ----------

function openKeyDialog() {
  $('#keyError').textContent = '';
  $('#keyInput').value = '';
  $('#keyDialog').showModal();
}

$('#keyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/key', { method: 'POST', json: { key: $('#keyInput').value } });
    state.hasKey = true;
    $('#keyDialog').close();
    toast('fal.ai connected');
  } catch (err) {
    $('#keyError').textContent = err.message;
  }
});
$('#keyCancel').addEventListener('click', () => $('#keyDialog').close());
$('#settingsBtn').addEventListener('click', openKeyDialog);

// Replicate runs only the "Seedance 2.5 · Replicate" model (half fal's price).
function openReplicateDialog() {
  $('#replicateError').textContent = '';
  $('#replicateInput').value = '';
  $('#replicateDialog').showModal();
}

$('#replicateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { username } = await api('/api/key/replicate', { method: 'POST', json: { key: $('#replicateInput').value } });
    state.hasReplicateKey = true;
    $('#replicateDialog').close();
    toast(username ? `Replicate connected (${username})` : 'Replicate connected');
  } catch (err) {
    $('#replicateError').textContent = err.message;
  }
});
$('#replicateCancel').addEventListener('click', () => $('#replicateDialog').close());
$('#replicateSwitch').addEventListener('click', () => { $('#keyDialog').close(); openReplicateDialog(); });

// ---------- Wiring ----------

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderGallery();
}));
document.querySelectorAll('.frame-slot').forEach((slot) => {
  slot.addEventListener('click', () => { if (!state[slot.dataset.slot]) pickFile(slot.dataset.slot); });
  makeDropZone(slot, () => slot.dataset.slot);
});
makeDropZone($('#refs'), refsKey);

promptEl.addEventListener('input', () => { prefs.prompts[prefs.tab] = promptEl.value; persist(); });

// UGC text fields: filled once from saved prefs, then saved as you type.
for (const [id, key] of [['ugcName', 'name'], ['ugcBenefit', 'benefit'], ['ugcCreator', 'creator'], ['ugcScript', 'script']]) {
  const input = $(`#${id}`);
  input.value = prefs.ugc[key];
  input.addEventListener('input', () => {
    prefs.ugc[key] = input.value;
    persist();
    if (key === 'creator' || key === 'script') renderUgc();
    updateCost();
  });
}
$('#ugcIdeas').addEventListener('click', () => {
  const u = prefs.ugc;
  u.script = scriptIdea(u.format, u.idea++, u.name, u.benefit);
  $('#ugcScript').value = u.script;
  persist();
  renderUgc();
  updateCost();
  if (!u.name.trim()) toast('Add your product name above for better script ideas');
});
makeDropZone($('#ugcProduct'), () => 'ugcProduct');
makeDropZone($('#ugcFace'), () => 'ugcFace');
$('#generateBtn').addEventListener('click', generate);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('#viewer').open && !$('#keyDialog').open) {
    e.preventDefault();
    generate();
  }
  if ($('#viewer').open && e.key === 'ArrowLeft') stepViewer(-1);
  if ($('#viewer').open && e.key === 'ArrowRight') stepViewer(1);
});

// Paste an image anywhere: it becomes a reference (Image) or a frame (Video).
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  if (prefs.tab === 'image') files.forEach((f) => addMedia(f, 'refs'));
  else if (prefs.tab === 'ugc') files.forEach((f) => addMedia(f, 'ugcProduct'));
  else addMedia(files[0], state.startFrame ? 'endFrame' : 'startFrame');
});

const viewer = $('#viewer');
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
viewer.addEventListener('close', () => $('#viewerMedia').replaceChildren());
viewer.querySelector('[data-close]').addEventListener('click', () => viewer.close());
$('#prevBtn').addEventListener('click', () => stepViewer(-1));
$('#nextBtn').addEventListener('click', () => stepViewer(1));

renderAll();
loadHistory();
api('/api/status').then(({ hasKey, hasReplicateKey }) => {
  state.hasKey = hasKey;
  state.hasReplicateKey = hasReplicateKey;
  if (!hasKey) openKeyDialog();
}).catch(() => {});
