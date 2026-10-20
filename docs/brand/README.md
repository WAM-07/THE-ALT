# Brand: the logos of The ALT Ecosystem

- `logo-pack/`: the four logos (ALT, ALTER, ALTAR, ALTERA) as the designer delivered them: SVG and PNG, light and dark, small sizes, app icons and 5-second animated SVGs. Its README gives the colours and what each folder is for.
- `classic/`: ALT's first mark, three bars (ALTAR green, ALTERA orange, ink), kept on purpose. SVG and PNG, light and dark.
- `make-icons.py`: copies the pack into the apps (launcher icons, launch-screen logo, favicons). Run `python docs/brand/make-icons.py` from the repository root after changing the pack (needs Pillow).

## Where the logos are used

| Where | What | How |
|---|---|---|
| ALTER (Flutter) | Loading splash and first-run splash (animated), sign-in and onboarding (still), launcher icon, launch screen | `AlterMark` → `AltLogo(AltLogoKind.alter)` |
| ALTERA (Flutter) | Splash (animated, on ink), sign-in and onboarding header, launcher icon, launch screen | `AltLogo(AltLogoKind.altera)` |
| Both apps | "Continue with ALT", the ALT sign-in card, the biometric lock screen | `AltMark` (ALT logo, or the classic bars) |
| ALTAR (web) | Header, footer, page loaders (animated), "Signing you in" (animated ALT), "Continue with ALT", favicon | `components/BrandLogo.js` |
| ALT Command Centre | Side rail and sign-in screen, "Checking staff access" and "Signing you in" (animated), favicon | `components/AltLogo.js` |
| ALT Account window | Header, favicon | `services/core/public/account/` |

The Flutter logos are drawn natively (`packages/alt_account/lib/src/ui/alt_logo.dart`) from the pack's geometry and replay its animation keyframes, so the apps need neither Lottie files nor SVG assets; they follow light and dark themes and stay still when the phone asks for reduced motion. The websites draw the same SVG inline and animate it with the pack's CSS (`globals.css`, `.brand-anim`).

## The classic three bars

Hidden on purpose, like the themes:

- **ALTER:** Profile → Advanced → **ALT mark** (also changes the mark in ALTER's sign-in card and lock screen).
- **ALTAR:** Settings → Advanced → Appearance lab → **ALT mark**.
- **Files:** `classic/alt-classic-light.svg`, `alt-classic-dark.svg` and the PNGs beside them.
