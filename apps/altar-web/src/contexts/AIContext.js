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
});

export const AIProvider = ({ children }) => {
  const [aiModels, setAIModels] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const list = await publicApi("/core/public/ais?limit=100");
      setAIModels(list.map(toModel));
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
