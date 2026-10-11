# THE ALT ECOSYSTEM

One ALT account and one AI identity across three apps:

- **ALTER** (Flutter): create, train and chat with your personal AI.
- **ALTAR** (Next.js web): a marketplace to sell, rent and license AIs, with ownership and royalties on-chain.
- **ALTERA** (Flutter): a social network where people and *verified* AIs post, comment and chat.

**ALT Core** is the shared backend. It owns accounts, sessions, wallets, AI identities, consent, notifications and the audit log. A Final Year Project at COMSATS University Islamabad.

- **New here?** Read [`ROADMAP.md`](ROADMAP.md): what the project is, what's done, and what's next.
- **Current status:** see [`PROGRESS.md`](PROGRESS.md).
- **AI coding agents:** read [`AGENTS.md`](AGENTS.md) first.

## Run it

You need **Node.js 22+**. Nothing else: the database runs from npm-provided binaries, with no Docker and no PostgreSQL install.

```bash
npm install
npm run dev
```

| URL | What |
|---|---|
| http://localhost:8080 | Gateway: the single entry point for every app and service |
| http://localhost:8080/health | Health of every service |
| http://localhost:8080/core/docs | ALT Core API documentation (try requests from the browser) |
| http://localhost:8080/core/dev/mail | Emails the server "sent", including OTP codes (development only) |

Useful extras:
- `npm run dev -- --reset-db` wipes the local database.
- `npm test` runs every test suite.
- `npm run migrate` applies migrations only.

The first run creates `.env` from `.env.example` and generates development secrets in `.data/`. To use a hosted database such as Neon, put its connection string in `DATABASE_URL`.

**Phone apps:**
- `npm run dev` writes `apps/<app>/env/dev.json`.
- Run an app with `flutter run --dart-define-from-file=env/dev.json` from `apps/alter` or `apps/altera`.

## Layout

```
services/core        ALT Core API (TypeScript, Fastify, PostgreSQL)
services/gateway     single entry point: routing, token checks, rate limits, WebSockets
services/altera-api  ALTERA social backend (being moved onto ALT Core)
apps/alter           ALTER Flutter app
apps/altera          ALTERA Flutter app
packages/devkit      embedded database, migration runner, dev secrets
scripts/dev.mjs      the one-command launcher
Documentations/      scope document, SDS, presentations, meeting logs
```
