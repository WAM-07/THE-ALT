"use client";
import { useEffect, useState } from "react";
import { api } from "./alt";

/** Loads one ALT resource as the signed-in member of staff. Keeps the last data while reloading. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
