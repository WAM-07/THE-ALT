"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// ALTAR's movement helpers. The CSS they rely on is in globals.css ("motion"); all of it is
// switched off for people whose system asks for reduced motion.

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Calls `onShow` once, the first time the element scrolls into view. */
function useInView(onShow, rootMargin = "0px 0px -8% 0px") {
  const ref = useRef(null);
  const shown = useRef(onShow);
  useEffect(() => {
    shown.current = onShow;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return shown.current(el);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          shown.current(el);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return ref;
}

/** Fades its content up when it scrolls into view. `delay` (ms) staggers neighbours. */
export function Reveal({ as: Tag = "div", delay = 0, className = "", style, children, ...rest }) {
  const ref = useInView((el) => el.setAttribute("data-shown", ""));
  return (
    <Tag ref={ref} className={`reveal ${className}`} style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

/** A number that counts up from zero once it is in view (and again if the number changes). Non-numbers are shown as they are. */
export function CountUp({ value, duration = 1200 }) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState(0);
  const ref = useInView(() => setSeen(true));
  useEffect(() => {
    if (!numeric || !seen) return;
    let raf;
    const start = performance.now();
    const step = (now) => {
      const t = reducedMotion() ? 1 : Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [numeric, seen, value, duration]);
  return <span ref={ref}>{numeric ? shown : value}</span>;
}

/**
 * Makes an element lean towards the mouse. Spread the returned props onto an element with the
 * `tilt` class; a child with `tilt-shine` lights up where the cursor is. Touch screens are left alone.
 */
export function useTilt(max = 8) {
  const frame = useRef(0);
  const onPointerMove = useCallback(
    (e) => {
      if (e.pointerType !== "mouse" || reducedMotion()) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.setAttribute("data-tilting", "");
        el.style.setProperty("--ry", `${(x - 0.5) * 2 * max}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * 2 * max}deg`);
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
      });
    },
    [max],
  );
  const onPointerLeave = useCallback((e) => {
    cancelAnimationFrame(frame.current);
    const el = e.currentTarget;
    el.removeAttribute("data-tilting");
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }, []);
  return { onPointerMove, onPointerLeave };
}

/** Pointer position over an element as --px / --py (-1 to 1), for parallax layers inside it. */
export function useParallax() {
  const frame = useRef(0);
  const onPointerMove = useCallback((e) => {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      el.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    });
  }, []);
  const onPointerLeave = useCallback((e) => {
    e.currentTarget.style.setProperty("--px", "0");
    e.currentTarget.style.setProperty("--py", "0");
  }, []);
  return { onPointerMove, onPointerLeave };
}
