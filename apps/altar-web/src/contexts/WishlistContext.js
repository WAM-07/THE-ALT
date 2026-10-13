"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { useModal } from "./ModalContext";

// AIs a person is keeping an eye on. Saved in this browser, per ALT account, for now;
// it moves to the ALTAR service when listings exist (so it can notify on price or availability).
const WishlistContext = createContext();
const keyFor = (user) => `altar_wishlist_${user.id}`;

const read = (user) => {
  try {
    return JSON.parse(localStorage.getItem(keyFor(user)) || "[]");
  } catch {
    return [];
  }
};

export const WishlistProvider = ({ children }) => {
  const [wishlist, setWishlist] = useState([]);
  const { user } = useAuth();
  const { showAlert } = useModal();

  useEffect(() => {
    setWishlist(user ? read(user) : []);
  }, [user]);

  const save = (list) => {
    setWishlist(list);
    try {
      localStorage.setItem(keyFor(user), JSON.stringify(list));
    } catch {
      // Private windows can refuse storage; the list still works for this visit.
    }
  };

  const addToWishlist = (agent) => {
    if (!user) return showAlert("Sign in first", "Sign in with your ALT account to keep a wishlist.");
    if (wishlist.some((item) => item.agentId === agent.id)) return showAlert("Already saved", `${agent.name} is already on your wishlist.`);
    save([...wishlist, { id: `WL-${agent.id}`, agentId: agent.id, agentName: agent.name, addedAt: new Date().toISOString() }]);
    showAlert("Saved", `${agent.name} is on your wishlist.`);
  };

  const removeFromWishlist = (agentId) => save(wishlist.filter((item) => item.agentId !== agentId));

  return <WishlistContext.Provider value={{ wishlist, addToWishlist, removeFromWishlist }}>{children}</WishlistContext.Provider>;
};

export const useWishlist = () => useContext(WishlistContext);
