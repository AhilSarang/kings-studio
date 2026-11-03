// The UGC reel recipe. Step 1: Nano Banana Pro makes a selfie-style photo of a
// creator holding your product (your product photos keep the label accurate).
// Step 2: a video model animates that photo into a talking, handheld reel.
// Edit the wording here to change how every reel is prompted.

export const PHOTO_MODEL = 'nano-banana-pro';

export const CREATORS = [
  'Woman in her 20s', 'Woman in her 30s', 'Man in his 20s', 'Man in his 30s', 'Mom in her 30s', 'Woman in her 50s',
];

export const SETTINGS = {
  bathroom: { label: 'Bathroom', text: 'a bright, lived-in bathroom with a mirror and a few things on the counter' },
  bedroom: { label: 'Bedroom', text: 'a cozy bedroom with soft daylight from a window' },
  kitchen: { label: 'Kitchen', text: 'a modern home kitchen in daylight' },
  car: { label: 'Car', text: 'the driver’s seat of a parked car, daylight through the windshield' },
  living: { label: 'Living room', text: 'a casual living room with a couch and plants' },
  gym: { label: 'Gym', text: 'a gym with equipment softly blurred behind them' },
  outdoors: { label: 'Outdoors', text: 'a sunny city sidewalk, softly blurred behind them' },
};

export const FORMATS = {
  talking: {
    label: 'Talking to camera',
    photo: 'holding the product up near their face with the label facing the camera, looking straight into the lens mid-sentence',
    motion: 'They talk straight to the camera and hold the product up toward the lens, with small natural hand gestures.',
    scripts: [
      'Okay, you need to know about {product}. It {benefit}, and honestly, it’s so worth it.',
      'Stop scrolling. If you want something that {benefit}, this is it. {product}. Go get it.',
      'This is your sign to try {product}. It {benefit}. Trust me, you’ll thank me later.',
    ],
  },
  unboxing: {
    label: 'Unboxing',
    photo: 'holding the product just taken out of an opened shipping box, showing it to the camera with an excited expression',
    motion: 'They lift the product out of the box and show it to the camera, turning it slightly so the label stays visible.',
    scripts: [
      'It’s finally here! This is {product}. It {benefit}. Okay, let’s open it up.',
      'Unboxing {product} with you. Everyone’s talking about it because it {benefit}. Look at this!',
    ],
  },
  demo: {
    label: 'Demo',
    photo: 'using the product and showing it to the camera',
    motion: 'They show how they use the product while talking to the camera, then hold it up so the label is visible.',
    scripts: [
      'Here’s how to use {product}. It takes seconds, and it {benefit}. So easy.',
      'Watch this. {product} {benefit}. Like, look at that.',
    ],
  },
  grwm: {
    label: 'Get ready with me',
    photo: 'getting ready in front of a mirror, holding the product while filming themselves',
    motion: 'They get ready while chatting to the camera, then pick up the product and show it.',
    scripts: [
      'Get ready with me. First step is always {product}, because it {benefit}.',
      'My go-to before I head out? {product}. It {benefit}, and it takes two seconds.',
    ],
  },
};

export function scriptIdea(formatKey, index, product, benefit) {
  const scripts = (FORMATS[formatKey] || FORMATS.talking).scripts;
  return scripts[index % scripts.length]
    .replaceAll('{product}', product.trim() || 'this')
    .replaceAll('{benefit}', benefit.trim().replace(/\.$/, '') || 'works so well')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, before, letter) => before + letter.toUpperCase());
}

// About 2.5 spoken words per second, plus a beat at the start and end.
export function speechSeconds(script) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.ceil(words / 2.5) + 2 : 0;
}

export function photoPrompt({ creator, setting, format, productCount, hasFace }) {
  const refs = productCount > 1 ? `first ${productCount} reference images` : 'first reference image';
  const who = hasFace
    ? `the person in the last reference image, with exactly the same face, hair and skin tone${creator ? ` (${creator})` : ''}`
    : creator || 'a friendly person in their 20s';
  return [
    'Vertical 9:16 smartphone selfie photo in authentic UGC style, like a frame from a TikTok or Instagram Reel.',
    `The creator: ${who}.`,
    `They are ${(FORMATS[format] || FORMATS.talking).photo}, in ${(SETTINGS[setting] || SETTINGS.bedroom).text}.`,
    `The product is exactly the one in the ${refs}: same shape, packaging, colors, logo and label text, unchanged and clearly readable.`,
    'Shot on an iPhone front camera at arm’s length, natural light, realistic skin texture, candid and unpolished.',
    'No text overlays, no captions, no watermark.',
  ].join(' ');
}

export function videoPrompt({ format, script }) {
  const line = script.trim().replace(/"/g, '\'');
  return [
    'Handheld smartphone selfie video in authentic UGC style.',
    (FORMATS[format] || FORMATS.talking).motion,
    `They speak naturally and with energy, saying: "${line}"`,
    'Their lips match the words. Slight handheld camera movement, natural room sound.',
    'Keep the product and its label exactly as they are.',
    'No background music, no subtitles, no text on screen.',
  ].join(' ');
}
