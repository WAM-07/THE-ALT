1. Push this project to GitHub.

2. In Render, create a new Blueprint and connect the repo.
   Render will read [render.yaml](/e:/FYP%202nd/render.yaml:1).

3. In Render, fill all `sync: false` environment variables from `altera_backend/.env`.
   Important:
   - use your real secrets, not placeholders
   - `DATABASE_URL` should be your Neon connection string
   - `HOST=0.0.0.0` and `PORT=10000` are already set in the blueprint

4. After deploy finishes, open:
   `https://YOUR-RENDER-SERVICE.onrender.com/health`
   It should return JSON with `"status":"ok"`.

5. Build the APK against that deployed backend:

```powershell
cd E:\FYP 2nd\altera_app
.\build_release_apk.ps1 -ApiUrl "https://YOUR-RENDER-SERVICE.onrender.com"
```

6. Install the generated APK from:
   [app-release.apk](</e:/FYP 2nd/altera_app/build/app/outputs/flutter-apk/app-release.apk>)

Notes:
- The current local-network APK approach is only for same-Wi-Fi testing.
- The Render-based APK is the durable solution that works away from your laptop too.
- If your Render service sleeps on the free plan, the first request can be slow.
