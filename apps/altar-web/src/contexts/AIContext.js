"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { mediaUrl, publicApi } from "../lib/alt";

// The catalog: verified AIs from ALT Core. Only AIs with a confirmed AI Identity Token (AIT)
// appear here; drafts never leave ALTER.
const AIContext = createContext();

/** Core's AI summary, in the shape the ALTAR screens use. */
export const toModel = (ai) => ({
  ...ai,
  image: mediaUrl(ai.avatarUrl),
  category: ai.category ? ai.category[0].toUpperCase() + ai.category.slice(1) : "Personal",
  creatorName: ai.creator?.displayName ?? "Unknown",
  ownerName: ai.owner?.displayName ?? "Unknown",
  version: ai.currentVersion?.version ?? null,
  // The token's artwork is drawn from its id on its contract (see AitArt).
  artSeed: ai.token ? `${ai.token.contract}:${ai.token.tokenId}` : ai.handle,
});

export const AIProvider = ({ children }) => {
  const [aiModels, setAIModels] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      // Prices come from ALTAR's listings (a mirror of the marketplace contract); browsing still works without them.
      const [list, listings] = await Promise.all([publicApi("/core/public/ais?limit=100&platform=altar"), publicApi("/altar/listings").catch(() => [])]);
      const byAi = new Map(listings.map((l) => [l.aiId, l]));
      setAIModels(list.map((ai) => ({ ...toModel(ai), listing: byAi.get(ai.id) ?? null })));
      setError(null);
    } catch (err) {
      setError(err);
      setAIModels((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <AIContext.Provider value={{ aiModels, error, reload }}>{children}</AIContext.Provider>;
};

export const useAI = () => useContext(AIContext);
