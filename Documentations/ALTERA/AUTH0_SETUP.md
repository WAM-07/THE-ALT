# Auth0 Setup

This project is now being aligned to:

- `PostgreSQL` for persistence
- `Auth0` for authentication

The current codebase is prepared for Auth0-based Google sign-in on Flutter web plus backend session exchange.

## 1. Create or select your Auth0 application

For Flutter web, use a `Single Page Application`.

In Auth0 dashboard:

1. Open your application.
2. Make sure the app type is `Single Page Application`.
3. Ensure `OIDC Conformant` is enabled.
4. Ensure the signing algorithm is `RS256`.

## 2. Configure callback and logout URLs

If you are running Flutter web on port `3001`, set:

- Allowed Callback URLs: `http://localhost:3001`
- Allowed Logout URLs: `http://localhost:3001`
- Allowed Web Origins: `http://localhost:3001`

## 3. Enable Google connection in Auth0

1. Go to `Authentication -> Social`.
2. Enable `Google`.
3. Complete the Google provider setup inside Auth0.

## 4. Update backend `.env`

Edit:

- [`.env`](E:/FYP%202nd/altera_backend/.env:1)

Add:

```env
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your_auth0_client_id
AUTH0_AUDIENCE=
```

## 5. Run Flutter web with Auth0 values

From `E:\FYP 2nd\altera_app` run:

```powershell
flutter run -d chrome --web-port 3001 `
  --dart-define=BACKEND_URL=http://localhost:3000 `
  --dart-define=AUTH0_DOMAIN=your-tenant.us.auth0.com `
  --dart-define=AUTH0_CLIENT_ID=your_auth0_client_id `
  --dart-define=AUTH0_AUDIENCE= `
  --dart-define=AUTH0_REDIRECT_URL=http://localhost:3001 `
  --dart-define=AUTH0_LOGOUT_URL=http://localhost:3001
```

## 6. Install the Flutter Auth0 SDK

The app now expects:

- `auth0_flutter`

If dependencies are not installed yet, run:

```powershell
flutter pub get
```

## 7. Important current status

- Email/password auth still uses the local backend JWT flow.
- `Continue with Google` is now aimed at Auth0 instead of Supabase.
- PostgreSQL migration is still a separate next step; several social features still run on the in-memory mock store.
