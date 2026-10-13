import "./globals.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { AuthProvider } from "../contexts/AuthContext";
import { AIProvider } from "../contexts/AIContext";
import { RegionProvider } from "../contexts/RegionContext";
import { ModalProvider } from "../contexts/ModalContext";
import { WishlistProvider } from "../contexts/WishlistContext";

export const metadata = {
  title: "ALTAR · The ALT marketplace",
  description: "Buy, rent and subscribe to verified personal AIs. Part of THE ALT ECOSYSTEM.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning className="font-sans bg-black text-black antialiased selection:bg-[#1dbf73] selection:text-white">
        <RegionProvider>
          <ModalProvider>
            <AuthProvider>
              <AIProvider>
                <WishlistProvider>
                  <Header />
                  <main className="min-h-screen">{children}</main>
                  <Footer />
                </WishlistProvider>
              </AIProvider>
            </AuthProvider>
          </ModalProvider>
        </RegionProvider>
      </body>
    </html>
  );
}
