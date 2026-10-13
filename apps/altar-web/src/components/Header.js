"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { useRegion } from "../contexts/RegionContext";
import { useWishlist } from "../contexts/WishlistContext";
import { usePathname } from "next/navigation";
import WishlistModal from "./WishlistModal";
import { continueWithAlt, mediaUrl } from "../lib/alt";
import ThemePicker from "./ThemePicker";

export default function Header() {
  const { user, logout } = useAuth();
  const userAvatar = mediaUrl(user?.avatarUrl);
  const { settings, updateSettings, t } = useRegion();
  const { wishlist } = useWishlist();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  const [tempSettings, setTempSettings] = useState({ ...settings });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const countries = [
    { code: "PK", name: "Pakistan", flag: "🇵🇰" },
    { code: "UK", name: "United Kingdom", flag: "🇬🇧" },
    { code: "US", name: "United States", flag: "🇺🇸" },
    { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
    { code: "FR", name: "France", flag: "🇫🇷" },
    { code: "DE", name: "Germany", flag: "🇩🇪" },
    { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
    { code: "PKR", name: "Pakistan", flag: "🇵🇰" },
  ];

  const languages = [
    { code: "EN", name: "English" },
    { code: "UR", name: "Urdu" },
    { code: "AR", name: "Arabic" },
    { code: "FR", name: "French" },
  ];

  const currencies = [
    { code: "PKR", symbol: "Rs", name: "Pakistani Rupee" },
    { code: "GBP", symbol: "£", name: "British Pound" },
    { code: "USD", symbol: "$", name: "US Dollar" },
    { code: "EUR", symbol: "€", name: "Euro" },
    { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  ];

  const handleSave = () => {
    updateSettings(tempSettings);
    setIsModalOpen(false);
  };

  if (!mounted) return null;

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 py-4 sm:px-8 transition-all duration-500">
        <div className="max-w-[1400px] mx-auto bg-black/40 in-data-[theme=daylight]:bg-black/90 backdrop-blur-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-[2rem] transition-all duration-500 hover:border-green-500/20 group/nav overflow-hidden">
          {/* Animated Inner Shine */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover/nav:translate-x-full transition-transform duration-1000"></div>

          <div className="relative px-6 py-2.5 flex justify-between items-center">
            {/* Logo Section */}
            <div className="flex flex-col group/logo">
              <Link href="/" className="text-white font-black text-2xl tracking-tighter flex items-center gap-1 group-hover/logo:text-green-400 transition-colors">
                ALTAR<span className="text-green-500 animate-pulse">_</span>
              </Link>
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 bg-green-500 rounded-full animate-flicker"></span>
                <p className="hidden sm:block text-[7px] uppercase tracking-[0.5em] text-white/30 font-black">AI Marketplace</p>
              </div>
            </div>

            {/* Navigation Links */}
            <div className="hidden lg:flex items-center gap-10 text-[11px] font-black uppercase tracking-[0.2em] text-white/40">
              {[
                { label: t('home'), path: "/", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg> },
                { label: t('listAi'), path: "/list-ai", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg> },
                { label: "Wishlist", onClick: () => setIsWishlistOpen(true), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>, count: wishlist?.length },
                ...(user ? [{ label: "My AIs", path: "/profile", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M4 22v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" /></svg> }] : [])
              ].map((item, idx) => (
                item.path ? (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`group/link relative flex items-center gap-3 transition-all duration-300 hover:text-white ${pathname === item.path ? "text-green-400" : ""}`}
                  >
                    <span className="opacity-50 group-hover/link:opacity-100 group-hover/link:scale-110 transition-all">{item.icon}</span>
                    {item.label}
                    {item.count > 0 && (
                      <span className="bg-green-500 text-black text-[8px] h-4 w-4 flex items-center justify-center rounded-full font-black shadow-[0_0_10px_rgba(34,197,94,0.5)]">
                        {item.count}
                      </span>
                    )}
                    <div className={`absolute -bottom-1 left-0 h-[1.5px] bg-green-500 transition-all duration-500 ${pathname === item.path ? "w-full" : "w-0 group-hover/link:w-full"}`}></div>
                  </Link>
                ) : (
                  <button
                    key={idx}
                    onClick={item.onClick}
                    className="group/link relative flex items-center gap-3 transition-all duration-300 hover:text-white"
                  >
                    <span className="opacity-50 group-hover/link:opacity-100 group-hover/link:scale-110 transition-all">{item.icon}</span>
                    {item.label}
                    {item.count > 0 && (
                      <span className="bg-green-500 text-black text-[8px] h-4 w-4 flex items-center justify-center rounded-full font-black shadow-[0_0_10px_rgba(34,197,94,0.5)]">
                        {item.count}
                      </span>
                    )}
                    <div className="absolute -bottom-1 left-0 h-[1.5px] bg-green-500 transition-all duration-500 w-0 group-hover/link:w-full"></div>
                  </button>
                )
              ))}
            </div>

            {/* Right Action Cluster */}
            <div className="flex items-center gap-3 sm:gap-6">
              <button
                onClick={() => setIsModalOpen(true)}
                className="w-10 h-10 flex items-center justify-center bg-white/5 border border-white/10 rounded-xl hover:border-green-500/50 hover:bg-white/10 transition-all group/region"
              >
                <span className="text-lg filter grayscale group-hover/region:grayscale-0 transition-all duration-500">
                  {settings.country.flag}
                </span>
              </button>

              {user ? (
                <div className="flex items-center gap-3 sm:gap-5">
                  <Link href="/wallet" className="hidden sm:flex items-center gap-3 bg-white/5 px-5 py-2.5 rounded-2xl border border-white/5 hover:border-green-500/30 hover:bg-white/10 transition-all group/wallet">
                    <span className="text-white/40 group-hover/wallet:text-green-400 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/60 group-hover/wallet:text-white transition-colors">
                      {t('wallet')}
                    </span>
                  </Link>

                  <Link href="/profile" className="relative group/avatar">
                    <div className="absolute inset-0 bg-green-500/20 blur-md rounded-full opacity-0 group-hover/avatar:opacity-100 transition-opacity"></div>
                    <div className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-green-600 to-emerald-400 p-[1px] shadow-xl overflow-hidden border border-white/10">
                      <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[11px] font-black overflow-hidden">
                        {userAvatar ? <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" /> : user.name?.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  </Link>

                  <button onClick={logout} className="hidden md:block text-[9px] font-black uppercase tracking-[0.2em] text-white/20 hover:text-red-500 transition-colors">
                    {t('logout')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4 sm:gap-8">
                  <button onClick={() => continueWithAlt("signin").catch(() => {})} className="hidden sm:inline text-[10px] font-black uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors">{t('signIn')}</button>
                  <button onClick={() => continueWithAlt("signup").catch(() => {})} className="bg-white text-black px-4 sm:px-8 py-3 rounded-2xl text-[10px] whitespace-nowrap font-black uppercase tracking-[0.2em] hover:bg-green-400 hover:shadow-[0_10px_30px_rgba(34,197,94,0.3)] transition-all active:scale-95">
                    {t('joinAltar')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Phones: the same places, as a compact row under the logo */}
          <div className="lg:hidden relative flex items-center justify-around border-t border-white/5 px-2 py-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/50">
            <Link href="/" className={pathname === "/" ? "text-green-400" : "hover:text-white"}>{t('home')}</Link>
            <Link href="/list-ai" className={pathname === "/list-ai" ? "text-green-400" : "hover:text-white"}>{t('listAi')}</Link>
            <button onClick={() => setIsWishlistOpen(true)} className="uppercase hover:text-white">Wishlist{wishlist?.length ? ` (${wishlist.length})` : ""}</button>
            {user ? (
              <>
                <Link href="/profile" className={pathname === "/profile" ? "text-green-400" : "hover:text-white"}>My AIs</Link>
                <Link href="/wallet" className={pathname === "/wallet" ? "text-green-400" : "hover:text-white"}>{t('wallet')}</Link>
              </>
            ) : (
              <button onClick={() => continueWithAlt("signin").catch(() => {})} className="uppercase hover:text-white">{t('signIn')}</button>
            )}
          </div>
        </div>
      </nav>

      {/* Global Settings Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setIsModalOpen(false)}></div>
          <div className="relative w-full max-w-[420px] bg-black/60 backdrop-blur-3xl p-8 border border-white/10 rounded-[40px] shadow-[0_0_50px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 blur-[60px] pointer-events-none"></div>
            <div className="relative">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">Regional Node</h2>
                  <p className="text-[10px] text-white/40 uppercase tracking-[0.3em] font-bold">Network Calibration</p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all border border-white/5">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2 group">
                  <label className="text-[9px] font-black uppercase tracking-widest text-white/40 ml-4 group-focus-within:text-green-400 transition-colors">{t('originLocation')}</label>
                  <div className="relative">
                    <select
                      value={settings.country.code}
                      onChange={(e) => {
                        const c = countries.find(x => x.code === e.target.value);
                        updateSettings({ ...settings, country: c });
                      }}
                      className="w-full appearance-none bg-black/40 border border-white/10 rounded-2xl p-4 pl-12 text-white font-bold focus:outline-none focus:border-green-500/50 transition-all cursor-pointer"
                    >
                      {countries.map(c => <option key={c.code} value={c.code} className="bg-black text-white">{c.flag} {c.name}</option>)}
                    </select>
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">{settings.country.flag}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 group">
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/40 ml-4 group-focus-within:text-green-400 transition-colors">{t('language')}</label>
                    <select
                      value={settings.language.code}
                      onChange={(e) => {
                        const l = languages.find(x => x.code === e.target.value);
                        updateSettings({ ...settings, language: l });
                      }}
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white font-bold focus:outline-none focus:border-green-500/50"
                    >
                      {languages.map(l => <option key={l.code} value={l.code} className="bg-black text-white">{l.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2 group">
                    <label className="text-[9px] font-black uppercase tracking-widest text-white/40 ml-4 group-focus-within:text-green-400 transition-colors">{t('currency')}</label>
                    <select
                      value={settings.currency.code}
                      onChange={(e) => {
                        const c = currencies.find(x => x.code === e.target.value);
                        updateSettings({ ...settings, currency: c });
                      }}
                      className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white font-bold focus:outline-none focus:border-green-500/50"
                    >
                      {currencies.map(c => <option key={c.code} value={c.code} className="bg-black text-white">{c.code}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase tracking-widest text-white/40 ml-4">Theme</label>
                  <ThemePicker compact />
                </div>

                <button
                  onClick={() => setIsModalOpen(false)}
                  className="group relative w-full bg-gradient-to-r from-green-600 to-green-400 text-white p-5 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all shadow-[0_10px_30px_rgba(34,197,94,0.2)] hover:shadow-[0_15px_40px_rgba(34,197,94,0.3)] hover:-translate-y-1 active:scale-95 mt-4"
                >
                  {t('initializeChanges')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <WishlistModal isOpen={isWishlistOpen} onClose={() => setIsWishlistOpen(false)} />
    </>
  );
}
