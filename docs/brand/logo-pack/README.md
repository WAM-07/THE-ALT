# ALT logo pack

The four logos share one A. Each platform has its own outline and inner mark.

| Logo | Outline | Inner mark | Colour |
|---|---|---|---|
| ALT (master) | Hexagon | Dot | Ink `#0E1525` with sapphire dot |
| ALTER | Rounded app square | Spark | Sapphire `#2152D9` |
| ALTAR | Coin (double rim) | Diamond | Green `#128A50` |
| ALTERA | Signal arcs | Typing dots | Orange `#E8601A` |

Background colours: ink `#0E1525`, light `#F5F4F0`. On dark backgrounds the ALT dot uses `#5B86F0`.

## Folders

- `svg/`: master logos. `-light` is for light backgrounds, `-dark` for dark backgrounds. Transparent.
- `svg/small/`: simplified versions for 16 to 32 px (thicker lines, no inner mark).
- `png/`: the same logos at 1024, 512 and 256 px; `png/small/` at 48, 32 and 16 px (favicons).
- `app-icons/`: dark tile icons, rounded (iOS-style and web) and square (Android adaptive icon foreground), as SVG and PNG at 1024, 512, 192 and 48 px.
- `animated/`: looping 5-second animated SVGs (CSS inside the SVG). They play in browsers, including via `<img src>`, and fall back to the static logo when the device asks for reduced motion.
- `preview.html`: open in a browser to watch all animated logos.

## Using them

- **Next.js (ALTAR, Command Centre):** use the SVGs directly, e.g. `<img src="/logos/altar-animated-light.svg" alt="ALTAR">`.
- **Flutter (ALTER, ALTERA):** static SVGs work with `flutter_svg`. Flutter does not play CSS-animated SVGs; for the animations, convert them to Lottie (After Effects + Bodymovin, or LottieFiles) and play them with the `lottie` package, or use a short video for the splash screen.
- **Report and slides:** use the PNGs, or the SVGs in Word (Insert > Pictures accepts SVG).
