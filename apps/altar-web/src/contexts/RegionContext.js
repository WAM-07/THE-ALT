"use client";
import { createContext, useContext, useState, useEffect } from "react";

const RegionContext = createContext();

export function RegionProvider({ children }) {
  const [settings, setSettings] = useState({
    country: { code: "UK", name: "United Kingdom", flag: "🇬🇧" },
    language: { code: "EN", name: "English" },
    currency: { code: "GBP", symbol: "£", name: "British Pound", rate: 1 }
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("altar_region_settings");
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse region settings", e);
      }
    }
  }, []);

  const updateSettings = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem("altar_region_settings", JSON.stringify(newSettings));
  };

  // Translation Dictionary
  const translations = {
    EN: {
      home: "Home",
      listAi: "List AI",
      cart: "Cart",
      wallet: "Wallet",
      logout: "Logout",
      joinAltar: "Join Altar",
      signIn: "Sign In",
      marketplace: "Marketplace",
      myListings: "My Listings",
      execute: "Execute",
      topSellers: "Top Sellers",
      originLocation: "Origin Location",
      language: "Language",
      currency: "Currency",
      initializeChanges: "Initialize Changes",
      health: "Health",
      assetValue: "Asset Value",
      licenseFee: "License Fee",
      viewDetails: "View Details",
      yourAi: "Your AI",
      chat: "Chat",
      checkout: "Checkout",
      orderSummary: "Order Summary",
      subtotal: "Subtotal",
      appliedDiscounts: "Applied Discounts",
      serviceFee: "Service Fee",
      totalPayable: "Total Payable",
      proceedToCheckout: "Proceed to Checkout",
      paymentMethod: "Payment Method",
      walletBalance: "Wallet Balance",
      confirm: "Confirm",
      status: "Status",
      exploreModels: "Explore Models",
      cartEmpty: "Your cart is empty",
      authorize: "Authorize"
    },
    UR: {
      home: "ہوم",
      listAi: "AI لسٹ کریں",
      cart: "کارٹ",
      wallet: "والٹ",
      logout: "لاگ آؤٹ",
      joinAltar: "Altar میں شامل ہوں",
      signIn: "سائن ان",
      marketplace: "مارکیٹ پلیس",
      myListings: "میری لسٹنگ",
      execute: "عمل درآمد",
      topSellers: "ٹاپ سیلرز",
      originLocation: "اصل مقام",
      language: "زبان",
      currency: "کرنسی",
      initializeChanges: "تبدیلیاں محفوظ کریں",
      health: "صحت",
      assetValue: "اثاثہ کی قیمت",
      licenseFee: "لائسنس فیس",
      viewDetails: "تفصیلات دیکھیں",
      yourAi: "آپ کا AI",
      chat: "چیٹ",
      checkout: "چیک آؤٹ",
      orderSummary: "آرڈر کا خلاصہ",
      subtotal: "ذیلی کل",
      appliedDiscounts: "اطلاق شدہ رعایت",
      serviceFee: "سروس فیس",
      totalPayable: "کل واجب الادا",
      proceedToCheckout: "چیک آؤٹ پر جائیں",
      paymentMethod: "ادائیگی کا طریقہ",
      walletBalance: "والٹ بیلنس",
      confirm: "تصدیق کریں",
      status: "حیثیت",
      exploreModels: "ماڈلز تلاش کریں",
      cartEmpty: "آپ کا کارٹ خالی ہے",
      authorize: "اجازت دیں"
    },
    AR: {
      home: "الرئيسية",
      listAi: "إدراج AI",
      cart: "العربة",
      wallet: "المحفظة",
      logout: "تسجيل الخروج",
      joinAltar: "انضم إلى Altar",
      signIn: "تسجيل الدخول",
      marketplace: "المتجر",
      myListings: "قوائمي",
      execute: "تنفيذ",
      topSellers: "الأكثر مبيعاً",
      originLocation: "الموقع الأصلي",
      language: "اللغة",
      currency: "العملة",
      initializeChanges: "بدء التغييرات",
      health: "الصحة",
      assetValue: "قيمة الأصول",
      licenseFee: "رسوم الترخيص",
      viewDetails: "عرض التفاصيل",
      yourAi: "الخاص بك AI",
      chat: "دردشة",
      checkout: "الدفع",
      orderSummary: "ملخص الطلب",
      subtotal: "المجموع الفرعي",
      appliedDiscounts: "الخصومات المطبقة",
      serviceFee: "رسوم الخدمة",
      totalPayable: "إجمالي المستحق",
      proceedToCheckout: "المتابعة للدفع",
      paymentMethod: "طريقة الدفع",
      walletBalance: "رصيد المحفظة",
      confirm: "تأكيد",
      status: "الحالة",
      exploreModels: "استكشاف النماذج",
      cartEmpty: "عربة التسوق فارغة",
      authorize: "تفويض"
    }
  };

  const t = (key) => {
    return translations[settings.language.code]?.[key] || translations["EN"][key] || key;
  };

  const formatPrice = (priceInUSD) => {
    const rates = {
      "USD": 1,
      "GBP": 0.8,
      "PKR": 280,
      "EUR": 0.92,
      "AED": 3.67
    };
    const rate = rates[settings.currency.code] || 1;
    const converted = priceInUSD * rate;
    
    return `${settings.currency.symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  return (
    <RegionContext.Provider value={{ settings, updateSettings, formatPrice, t }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  const context = useContext(RegionContext);
  if (!context) {
    throw new Error("useRegion must be used within a RegionProvider");
  }
  return context;
}
