# Auth0 Google Sign-In Callback URL Fix

## Problem
The "Callback URL mismatch" error during Google sign-in was caused by misalignment between:
1. App configuration and Auth0 dashboard settings
2. Android deep link registration
3. iOS URL scheme configuration

## Solution Applied

### 1. Unified Android Deep-Link Registration
**File:** `altera_app/android/app/build.gradle.kts`
- Added `auth0PackageName` manifest placeholder
- Now uses template variables: `${auth0Domain}`, `${auth0Scheme}`, `${auth0PackageName}`

**File:** `altera_app/android/app/src/main/AndroidManifest.xml`
- Updated intent-filter to use manifest placeholders instead of hardcoded values
- Callback now dynamically resolves to: `altera://dev-5ntz6q1ho6k7jxdg.us.auth0.com/android/com.alteraapp.altera_app/callback`

### 2. Added iOS URL Scheme Registration
**File:** `altera_app/ios/Runner/Info.plist`
- Added `CFBundleURLTypes` configuration with `altera` scheme
- iOS app now recognizes and handles auth callbacks

### 3. Enhanced App Config
**File:** `altera_app/lib/config/app_config.dart`
- Added `auth0AndroidPackageName` constant
- Added `auth0AndroidRedirectUrl` getter that constructs the exact callback URL expected by Auth0
- Formula: `{scheme}://{domain}/android/{package}/callback`

### 4. Improved Error Messages
**File:** `altera_app/lib/services/auth_service.dart`
- Enhanced error handling in `loginWithGoogle()` to detect callback URL mismatches
- Returns helpful message if Auth0 callback URLs are not configured

## CRITICAL: Auth0 Dashboard Configuration

You must update your Auth0 application settings with the EXACT callback URLs for all platforms:

### For Android/Native Mobile:
**Allowed Callback URLs & Allowed Logout URLs (add this URL to BOTH fields):**
```
altera://dev-5ntz6q1ho6k7jxdg.us.auth0.com/android/com.alteraapp.altera_app/callback
```

### For iOS/Native Mobile:
**Allowed Callback URLs & Allowed Logout URLs (add this URL to BOTH fields):**
```
altera://callback
```
(or configure in similar format if iOS uses full domain, but typically it's just the scheme + callback)

### For Web (if applicable):
Your existing callback URLs should be preserved (usually `http://localhost:3000/callback` for dev)

### Steps to Update in Auth0 Dashboard:
1. Go to Auth0 Dashboard → Applications → Your App
2. Click "Settings" tab
3. Scroll to "Application URIs" section
4. Add the Android callback URL to **"Allowed Callback URLs"**
5. Add the SAME URL to **"Allowed Logout URLs"** (This fixes the "Oops!" error on logout)
6. **IMPORTANT:** Click "Save Changes" at the bottom
7. Test logout and login after saving

## Testing Checklist
- [ ] Auth0 dashboard updated with new callback URLs
- [ ] Android manifest placeholders verified in `build.gradle.kts`
- [ ] iOS Info.plist has `CFBundleURLTypes` with `altera` scheme
- [ ] `AppConfig.auth0AndroidRedirectUrl` matches Auth0 settings
- [ ] Google sign-in tested on Android emulator/device
- [ ] Google sign-in tested on iOS simulator/device

## Debugging
If "Callback URL mismatch" error persists:
1. Verify exact callback URL in Auth0 dashboard matches app output
2. Check `AppConfig.auth0AndroidRedirectUrl` prints correctly
3. Ensure no trailing slashes or spacing differences
4. Clear app cache and rebuild
5. Check Auth0 logs in dashboard for exact callback attempt

## Files Modified
- `lib/config/app_config.dart`
- `lib/services/auth_service.dart`
- `android/app/build.gradle.kts`
- `android/app/src/main/AndroidManifest.xml`
- `ios/Runner/Info.plist`

## Next Steps
1. Update Auth0 dashboard with new callback URL (see CRITICAL section above)
2. Rebuild APK/IPA with: `flutter build apk --release` or `flutter build ios`
3. Test Google sign-in flow
4. Monitor Auth0 logs for callback success
