// Shared by the server (to build fal.ai requests) and the browser (to draw the
// controls and estimate cost). To add a model, add an entry here.
//
// Prices are fal.ai's published rates, checked Oct 5, 2026 (Replicate's for the
// Replicate entry, checked Oct 6). Your dashboards have the exact charges.
// An entry with provider: 'replicate' runs on Replicate instead of fal.ai.

const IMAGE_ASPECTS = ['auto', '1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '4:3', '5:4', '21:9'];
const res = (...values) => values.map((value) => ({ value, label: value.replace(/P$/, 'p') }));

export const MODELS = {
  // ---------- Image ----------
  'flux-3': {
    kind: 'image',
    label: 'FLUX 3',
    vendor: 'Black Forest Labs',
    price: '~$0.05/image',
    tagline: 'Photoreal detail and the best text in images. Native 2K/4K.',
    endpoint: 'blackforestlabs/flux-3/text-to-image',
    editEndpoint: 'blackforestlabs/flux-3/edit-image',
    maxRefs: 10,
    maxImages: 1,
    aspects: IMAGE_ASPECTS,
    defaultAspect: '1:1',
    resolutions: [
      { value: '1k', label: '1K' },
      { value: '2k', label: '2K' },
      { value: '4k', label: '4K' },
    ],
    defaultResolution: '2k',
    cost(f) {
      // $0.048 for a 1MP image ($0.024 during the launch discount that ends Oct 8, 2026).
      // fal only partly publishes 2K/4K prices, so those are approximate.
      const promo = Date.now() < Date.UTC(2026, 9, 9);
      const mp = { '1k': 1, '2k': 4, '4k': 16 }[f.resolution] ?? 1;
      return { usd: (0.0386 + 0.0093 * mp) * (promo ? 0.5 : 1), note: f.resolution === '1k' ? '' : 'approx.' };
    },
  },
  'nano-banana-pro': {
    kind: 'image',
    label: 'Nano Banana Pro',
    vendor: 'Google',
    price: '$0.15/image',
    tagline: 'Smartest edits. Keeps products and faces consistent across shots.',
    endpoint: 'fal-ai/nano-banana-pro',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    maxRefs: 14,
    maxImages: 4,
    aspects: IMAGE_ASPECTS,
    defaultAspect: '1:1',
    resolutions: res('1K', '2K', '4K'),
    defaultResolution: '2K',
    cost: (f) => ({ usd: f.count * (f.resolution === '4K' ? 0.3 : 0.15) }),
  },
  'nano-banana-2': {
    kind: 'image',
    label: 'Nano Banana 2',
    vendor: 'Google',
    price: '$0.08/image',
    tagline: 'Faster and cheaper Nano Banana for quick drafts.',
    endpoint: 'fal-ai/nano-banana-2',
    editEndpoint: 'fal-ai/nano-banana-2/edit',
    maxRefs: 14,
    maxImages: 4,
    aspects: IMAGE_ASPECTS,
    defaultAspect: '1:1',
    resolutions: res('1K', '2K', '4K'),
    defaultResolution: '2K',
    cost: (f) => ({ usd: f.count * 0.08 * ({ '1K': 1, '2K': 1.5, '4K': 2 }[f.resolution] ?? 1) }),
  },

  // ---------- Video ----------
  // Each video model turns the normalized form into its own fal.ai request,
  // because field names differ (image_url vs start_image_url, etc.).
  'wan-3.0': {
    kind: 'video',
    label: 'Wan 3.0',
    vendor: 'Alibaba',
    price: '$0.10/s at 720p',
    tagline: '#1 in blind tests for text-to-video. Up to 30s with audio, about 5× cheaper than Seedance.',
    aspects: ['auto', '9:16', '3:4', '1:1', '4:3', '16:9'],
    defaultAspect: '9:16',
    resolutions: res('480p', '720p', '1080p'),
    defaultResolution: '720p',
    duration: { min: 2, max: 30, auto: true, default: 5 },
    audioToggle: true,
    maxRefs: 10, // product photos, used when there's no start frame
    request(v) {
      const input = { resolution: v.resolution, duration: v.seconds, audio: v.audio }; // null = model picks length
      if (v.prompt) input.prompt = v.prompt;
      if (v.exactPrompt) input.enable_prompt_expansion = false;
      if (v.startFrame) {
        input.start_image_url = v.startFrame;
        if (v.endFrame) input.end_image_url = v.endFrame;
        return { endpoint: 'alibaba/wan-3.0/image-to-video', input };
      }
      input.aspect_ratio = v.aspect === 'auto' ? 'adaptive' : v.aspect;
      if (v.refs.length) {
        // The prompt can point at them as "Image 1", "Image 2"… in upload order.
        input.reference_image_urls = v.refs;
        return { endpoint: 'alibaba/wan-3.0/reference-to-video', input };
      }
      return { endpoint: 'alibaba/wan-3.0/text-to-video', input };
    },
    cost: (v) => ({ usd: ({ '480p': 0.05, '720p': 0.1, '1080p': 0.2 }[v.resolution] ?? 0.1) * (v.seconds ?? 10) }),
  },
  'minimax-h3-max': {
    kind: 'video',
    label: 'MiniMax H3 Max',
    vendor: 'MiniMax × fal',
    price: '$0.08/s',
    tagline: '#1 in blind tests for animating images. Cheapest here. 5–15s, audio always on.',
    aspects: ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'],
    defaultAspect: '9:16',
    resolutions: res('480P', '768P'),
    defaultResolution: '768P',
    duration: { min: 5, max: 15, auto: false, default: 5 },
    audioToggle: false,
    promptRequired: true,
    request(v) {
      const input = {
        prompt: v.prompt, prompt_expansion_mode: v.exactPrompt ? 'disabled' : 'balanced', resolution: v.resolution, duration: v.seconds,
      };
      if (v.startFrame) {
        input.image_url = v.startFrame;
        if (v.endFrame) input.end_image_url = v.endFrame;
        return { endpoint: 'minimax/h3-max/image-to-video', input };
      }
      input.aspect_ratio = v.aspect;
      return { endpoint: 'minimax/h3-max/text-to-video', input };
    },
    cost: (v) => ({ usd: ({ '480P': 0.05, '768P': 0.08 }[v.resolution] ?? 0.08) * v.seconds }),
  },
  'seedance-2.5': {
    kind: 'video',
    label: 'Seedance 2.5',
    vendor: 'ByteDance',
    price: '$0.46/s at 720p',
    tagline: 'Premium. Best at keeping one product or character consistent. Up to 30s.',
    aspects: ['auto', '9:16', '3:4', '1:1', '4:3', '16:9', '21:9'],
    defaultAspect: '9:16',
    resolutions: res('480p', '720p', '1080p'),
    defaultResolution: '720p',
    duration: { min: 4, max: 30, auto: true, default: 5 },
    audioToggle: true,
    request(v) {
      const input = { resolution: v.resolution, duration: v.seconds ? String(v.seconds) : 'auto', generate_audio: v.audio };
      if (v.prompt) input.prompt = v.prompt;
      if (v.startFrame) {
        input.image_url = v.startFrame;
        if (v.endFrame) input.end_image_url = v.endFrame;
        return { endpoint: 'bytedance/seedance-2.5/image-to-video', input };
      }
      input.aspect_ratio = v.aspect;
      return { endpoint: 'bytedance/seedance-2.5/text-to-video', input };
    },
    cost(v) {
      // Billed in tokens: width × height × seconds × 24 / 1024, per 1,000 tokens.
      const short = { '480p': 480, '720p': 720, '1080p': 1080 }[v.resolution] ?? 720;
      const [a, b] = (v.startFrame || v.aspect === 'auto' ? '16:9' : v.aspect).split(':').map(Number);
      const tokens = (short * short * (Math.max(a, b) / Math.min(a, b)) * (v.seconds ?? 10) * 24) / 1024;
      return { usd: (tokens / 1000) * (v.resolution === '1080p' ? 0.0234 : 0.0214) };
    },
  },
  // The same model on Replicate, which sells it at ByteDance's direct price (about half of fal's).
  // ByteDance's own API (BytePlus ModelArk) isn't sold in the US. Needs a Replicate API token.
  'seedance-2.5-replicate': {
    kind: 'video',
    provider: 'replicate',
    label: 'Seedance 2.5 · Replicate',
    vendor: 'ByteDance via Replicate',
    price: '$0.10/s at 480p',
    tagline: 'The same Seedance 2.5 at about half the fal price. Needs a Replicate key. 480p or 720p.',
    aspects: ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'],
    defaultAspect: '9:16',
    resolutions: res('480p', '720p'),
    defaultResolution: '480p',
    duration: { min: 4, max: 30, auto: true, default: 5 },
    audioToggle: true,
    request(v) {
      const input = { resolution: v.resolution, duration: v.seconds ?? -1, generate_audio: v.audio, watermark: false };
      if (v.prompt) input.prompt = v.prompt;
      if (v.startFrame) {
        input.image = v.startFrame;
        if (v.endFrame) input.last_frame_image = v.endFrame;
        input.aspect_ratio = 'adaptive';   // required with a first frame; follows the frame's shape
      } else {
        input.aspect_ratio = v.aspect;
      }
      return { endpoint: 'bytedance/seedance-2.5', input };
    },
    cost: (v) => ({ usd: ({ '480p': 0.1028, '720p': 0.2312 }[v.resolution] ?? 0.2312) * (v.seconds ?? 10) }),
  },
};

export const modelsOfKind = (kind) =>
  Object.entries(MODELS).filter(([, m]) => m.kind === kind).map(([id]) => id);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// A video duration setting is 'auto' or a number of seconds, kept as a string.
export function validDuration(m, value) {
  const d = m.duration;
  if (value === 'auto') return d.auto ? 'auto' : String(d.default);
  const n = parseInt(value, 10);
  return String(Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.default);
}

// Cleans up the form the UI sends so models only see values they support.
function normalize(form) {
  const m = MODELS[form.model];
  if (!m) throw new Error(`Unknown model "${form.model}"`);
  const v = {
    model: m,
    prompt: String(form.prompt || '').trim(),
    resolution: pick(form.resolution, m.resolutions.map((r) => r.value), m.defaultResolution),
    aspect: pick(form.aspect, m.aspects, m.defaultAspect),
  };
  v.refs = (form.refs || []).filter(Boolean).slice(0, m.maxRefs || 0);
  if (m.kind === 'image') {
    v.count = m.maxImages > 1 ? Math.min(m.maxImages, Math.max(1, parseInt(form.numImages, 10) || 1)) : 1;
  } else {
    const duration = validDuration(m, form.duration);
    v.seconds = duration === 'auto' ? null : Number(duration);
    v.audio = form.audio !== false;
    v.exactPrompt = form.exactPrompt === true; // UGC: say the script word for word, no AI rewriting
    v.startFrame = form.startFrame || null;
    v.endFrame = (form.startFrame && form.endFrame) || null;
  }
  return v;
}

// Turns the form the UI sends into { endpoint, input } for fal.queue.submit (or Replicate).
export function buildRequest(form) {
  const v = normalize(form);
  const m = v.model;
  if (m.kind === 'image') {
    if (!v.prompt) throw new Error('Write a prompt first.');
    const input = { prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.resolution, output_format: 'png' };
    if (m.maxImages > 1) input.num_images = v.count;
    if (v.refs.length) input.image_urls = v.refs;
    return { endpoint: v.refs.length ? m.editEndpoint : m.endpoint, input };
  }
  if (!v.prompt && (m.promptRequired || !v.startFrame)) {
    throw new Error(m.promptRequired ? `${m.label} needs a prompt describing the motion.` : 'Write a prompt, or add a start frame to animate.');
  }
  return m.request(v);
}

export function estimateCost(form) {
  try {
    const v = normalize(form);
    const { usd, note = '' } = v.model.cost(v);
    return { usd, note: note || (v.model.kind === 'video' && v.seconds === null ? 'if ~10s' : '') };
  } catch {
    return { usd: 0, note: '' };
  }
}

export const formatUsd = (usd) => (usd < 0.1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);
