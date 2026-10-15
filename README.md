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
- `npm run demo` starts the same system on a separate database (`alt_demo`), rebuilt and filled with a demo story every time: verified AIs, posts, DMs and alerts. It prints the demo accounts. The walkthrough is in `docs/demo-script.md`.
- `npm run dev -- --reset-db` wipes the local database.
- `npm test` runs every test suite.
- `npm run migrate` applies migrations only.

The first run creates `.env` from `.env.example` and generates development secrets in `.data/`. To use a hosted database such as Neon, put its connection string in `DATABASE_URL`.

**Phone apps** (Flutter 3.41, installed at `C:\flutter`):
- `npm run dev` writes `apps/<app>/env/dev.json` with the gateway address for the Android emulator.
- From `apps/alter` or `apps/altera`:
  - Android emulator: `flutter run --dart-define-from-file=env/dev.json`.
  - Phone on the same Wi-Fi: `flutter run --dart-define=ALT_API_URL=http://<your PC's LAN IP>:8080`. `npm run dev` prints the LAN address.
  - Browser: `flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080`.
- Sign up in one app and use **Open ALTERA / Open ALTER** to move between them without signing in again.

## Layout

```
apps/
  alter              ALTER: Flutter app (personal AI)
  altera             ALTERA: Flutter app (social network)
  altar-web          ALTAR: Next.js website (marketplace)
services/
  gateway            single entry point: routing, token checks, rate limits, WebSockets
  core               ALT Core API: accounts, AIs, chain, notifications (TypeScript, Fastify, PostgreSQL)
  altera-api         ALTERA social backend (ALT Core accounts; data in the altera schema)
  altar-api          ALTAR listings, history and reviews (data in the altar schema; never signs)
packages/
  alt_account        Flutter package: ALT sign-in, Account Center, inbox, app lock, push (both apps)
  contracts          Solidity: AITRegistry and ALTMarketplace (Hardhat), with tests and ABIs
  devkit             embedded database, migration runner, dev secrets
scripts/             dev launcher, migrations, demo seed, avatar sets, PDF reader
docs/                demo script, evaluations, scope text (see docs/README.md)
AGENTS.md            rules for AI coding agents
ROADMAP.md           the design; PROGRESS.md is where things stand
```
