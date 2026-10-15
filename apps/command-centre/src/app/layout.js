import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Shell } from "../components/Shell";
import { StaffProvider } from "../components/Staff";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "ALT Command Centre",
  description: "Staff only: moderation, support, people and the audit log for THE ALT ECOSYSTEM.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    // Browser extensions add attributes to <html> and <body> before React hydrates (a known, harmless
    // mismatch); this silences it for these two elements only, as ALTAR web does.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <StaffProvider>
          <Shell>{children}</Shell>
        </StaffProvider>
      </body>
    </html>
  );
}
