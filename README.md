# Kings Studio

Your own image and video studio with only the models you use, paid per generation through [fal.ai](https://fal.ai). No subscription and no credit packs.

| Tab | Model | fal.ai endpoint | Price (Oct 2026) |
|---|---|---|---|
| Image | FLUX 3 | `blackforestlabs/flux-3/*` | $0.048 per 1K image ($0.024 until Oct 8 launch promo); 2K/4K cost more |
| Image | Nano Banana Pro | `fal-ai/nano-banana-pro` | $0.15 per image at 1K/2K, $0.30 at 4K |
| Image | Nano Banana 2 | `fal-ai/nano-banana-2` | $0.08 at 1K, $0.12 at 2K, $0.16 at 4K |
| Video | Wan 3.0 (default) | `alibaba/wan-3.0/*` | $0.05/s at 480p, $0.10/s at 720p (5s = $0.50), $0.20/s at 1080p |
| Video | MiniMax H3 Max | `minimax/h3-max/*` | $0.05/s at 480p, $0.08/s at 768p (5s = $0.40). 5–15s, audio always on |
| Video | Seedance 2.5 | `bytedance/seedance-2.5/*` | ~$0.46/s at 720p (5s ≈ $2.31), ~$0.21/s at 480p, ~$1.14/s at 1080p |

On Artificial Analysis's blind-vote leaderboards, Wan 3.0 ranks #1 for text-to-video, above Seedance 2.5 at #3. MiniMax H3 Max ranks #1 for image-to-video. Seedance 2.5 is still the pick when one product or character has to stay identical across many references.

## Start it

1. Double-click **Start Kings Studio.command**. The first time, macOS may block it: right-click it, choose **Open**, then **Open** again.
2. Your browser opens at http://localhost:3737.
3. Paste your fal.ai API key when asked. Get one at [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) and add credit at [fal.ai/dashboard/billing](https://fal.ai/dashboard/billing).

Or from Terminal: `npm install`, then `npm start`.

## How it works

- **Image tab:** write a prompt and generate. Add reference images (drop, paste or click +) to edit or restyle a product, or combine several images into one shot.
- **Video tab:** pick Wan 3.0, MiniMax H3 Max or Seedance 2.5. Write a prompt for text-to-video, or add a **start frame** (and optionally an **end frame**) to animate an image. All three generate audio.
- **Animate with…:** open any image you made and send it straight to the selected video model.
- **UGC tab:** makes a vertical UGC reel in one click. Add 1–3 photos of your product, pick a creator, setting and format, and write what they say (or tap **Script idea**). Nano Banana Pro makes a selfie-style shot of the creator holding your product ($0.15), then your chosen video model turns it into a talking reel. The creator says your script word for word, and the reel length is set from the script. Both the photo and the video land in the gallery; open a creator shot you like and click **Use this person in UGC reels** to keep the same face in every reel. Edit `public/ugc.js` to change the prompts or add script templates.
- Every result downloads to the `outputs/` folder, so you keep your files even if fal.ai links expire.
- The **This month** number in the top bar is estimated from published prices. Your [fal.ai usage page](https://fal.ai/dashboard/usage) has the exact charges.

## Good to know

- Your key is stored in `.env` next to `server.js`, readable only by your Mac user account. It never goes to the browser.
- The server listens only on this computer (`127.0.0.1`), so other devices on your Wi-Fi can't use your credits.
- If you quit while something is rendering, it picks the job back up the next time you start.
- To add or change models, edit `public/models.js`.
