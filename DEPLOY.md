# Deploying EngineerTutor to Vercel

This deploys the **web app** (`web/`) to a public URL you can open on any phone
and "Add to Home Screen." It takes about 5 minutes.

> **What you'll need:** a free [Vercel](https://vercel.com) account, your GitHub
> account connected to it, and your `ANTHROPIC_API_KEY` (and optionally
> `YOUTUBE_API_KEY`). See the main README for how to get the keys.

---

## Option A — Vercel dashboard (recommended, no terminal)

1. **Sign in** at [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New… → Project**.
3. **Import** the `nboom25-creator/Code` repository. If you don't see it, click
   **Adjust GitHub App Permissions** and grant access to the repo.
4. In the configuration screen, set:
   - **Root Directory** → click **Edit** and choose **`web`**  ← *this is the
     important one — the app lives in the `web/` subfolder.*
   - **Framework Preset** → should auto-detect **Next.js** (leave it).
   - Build & Output settings → leave defaults (`npm run build`).
5. Expand **Environment Variables** and add:
   | Name | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
   | `ANTHROPIC_MODEL` | `claude-sonnet-5` *(optional)* |
   | `YOUTUBE_API_KEY` | your YouTube key *(optional — for real videos)* |

   > **Do NOT set `CALC_SERVICE_URL`.** Without it, the app uses its built-in
   > JavaScript unit checker (clearly labeled). To get full SymPy/Pint numeric
   > evaluation in production, deploy `calc/` separately (see below) and set
   > `CALC_SERVICE_URL` to its URL.
6. Click **Deploy**. After ~2 minutes you'll get a URL like
   `https://code-xxxx.vercel.app`.
7. Open that URL **on your phone**, then:
   - **iPhone (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home Screen**.

   It launches full-screen with the EngineerTutor icon, like a native app.

Every push to your branch auto-deploys a new version.

---

## Option B — Vercel CLI (from your own computer)

```bash
npm i -g vercel
cd Code/web
vercel                      # first run links/creates the project; accept Next.js preset
# set env vars (repeat for each; choose Production when prompted):
vercel env add ANTHROPIC_API_KEY
vercel env add YOUTUBE_API_KEY       # optional
vercel --prod                        # deploy to production
```

When the CLI asks for the root directory, keep it as the current folder (`web`).

---

## Optional — deploy the Python calc service

The calc service gives full symbolic evaluation. It's a standard FastAPI app;
host it anywhere that runs Python (Render, Railway, Fly.io, a small VM):

```bash
# example start command
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Then, in your Vercel project settings, add:

```
CALC_SERVICE_URL = https://your-calc-service.example.com
```

and redeploy. The app will route calculations through it and label results as
"SymPy + Pint" instead of the JS fallback.

---

## Troubleshooting

- **Build fails with "No Next.js version detected"** → Root Directory isn't set
  to `web`. Fix it in **Project → Settings → General → Root Directory**.
- **Lessons show "Configuration needed"** → `ANTHROPIC_API_KEY` isn't set (or is
  invalid) in **Project → Settings → Environment Variables**. Add it and redeploy.
- **Videos show "not configured"** → add `YOUTUBE_API_KEY` (optional).
- **Changes not showing** → Vercel deploys per git push; check the
  **Deployments** tab for status.
