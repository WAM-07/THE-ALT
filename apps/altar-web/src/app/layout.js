import "./globals.css";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Header from "../components/Header";
import Footer from "../components/Footer";
import PolicyBanner from "../components/PolicyBanner";
import { AuthProvider } from "../contexts/AuthContext";
import { AIProvider } from "../contexts/AIContext";
import { RegionProvider } from "../contexts/RegionContext";
import { ModalProvider } from "../contexts/ModalContext";
import { WishlistProvider } from "../contexts/WishlistContext";
import { ThemeProvider } from "../contexts/ThemeContext";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata = {
  title: "ALTAR · The marketplace for verified AIs",
  description: "Own, rent or subscribe to verified personal AIs. Every one carries an AI Identity Token. Part of THE ALT ECOSYSTEM.",
};

// Themes other than the default (see ThemeContext). Older saved choices that no longer exist are ignored.
const THEME_SCRIPT = `try{var t=localStorage.getItem("altar_theme");if(["night","forest","original"].indexOf(t)>-1)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme (key "altar_theme") before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="font-sans bg-canvas text-ink antialiased">
        <ThemeProvider>
          <RegionProvider>
            <ModalProvider>
              <AuthProvider>
                <AIProvider>
                  <WishlistProvider>
                    <div className="flex min-h-screen flex-col">
                      <Header />
                      <PolicyBanner />
                      <main className="flex-1">{children}</main>
                      <Footer />
                    </div>
                  </WishlistProvider>
                </AIProvider>
              </AuthProvider>
            </ModalProvider>
          </RegionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
