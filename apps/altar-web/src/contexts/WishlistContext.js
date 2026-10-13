"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { altar } from "../lib/alt";
import { useAuth } from "./AuthContext";
import { useModal } from "./ModalContext";

// AIs a person keeps an eye on ("Saved"), kept by the ALTAR service for their ALT account, so the
// list follows them to any browser. Items saved in this browser before that are moved over once.
const WishlistContext = createContext();
const legacyKey = (user) => `altar_wishlist_${user.id}`;

const toItem = (w) => ({ id: w.aiId, agentId: w.aiId, savedAt: w.savedAt });

export const WishlistProvider = ({ children }) => {
  const [wishlist, setWishlist] = useState([]);
  const { user } = useAuth();
  const { showAlert } = useModal();

  const load = useCallback(async () => {
    if (!user) return setWishlist([]);
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyKey(user)) || "[]");
      if (legacy.length) {
        await Promise.allSettled(legacy.map((w) => altar.save(w.agentId)));
        localStorage.removeItem(legacyKey(user));
      }
    } catch {
      // Storage can be blocked; nothing to move then.
    }
    try {
      setWishlist((await altar.saved()).map(toItem));
    } catch {
      setWishlist([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const addToWishlist = async (agent) => {
    if (!user) return showAlert("Sign in first", "Sign in with your ALT account to save AIs.");
    if (wishlist.some((item) => item.agentId === agent.id)) return;
    // The heart fills in straight away; the save happens behind it.
    setWishlist((list) => [{ id: agent.id, agentId: agent.id, savedAt: new Date().toISOString() }, ...list]);
    try {
      await altar.save(agent.id);
    } catch (err) {
      setWishlist((list) => list.filter((i) => i.agentId !== agent.id));
      showAlert("Couldn't save", err.message);
    }
  };

  const removeFromWishlist = async (agentId) => {
    const before = wishlist;
    setWishlist((list) => list.filter((item) => item.agentId !== agentId));
    try {
      await altar.unsave(agentId);
    } catch {
      setWishlist(before);
    }
  };

  return <WishlistContext.Provider value={{ wishlist, addToWishlist, removeFromWishlist }}>{children}</WishlistContext.Provider>;
};

export const useWishlist = () => useContext(WishlistContext);
