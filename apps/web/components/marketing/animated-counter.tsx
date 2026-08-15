"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

// Counts up from 0 to `value` once the element scrolls into view. Respects
// prefers-reduced-motion by jumping straight to the final number instead of
// animating — a numeric count-up is decorative motion, not a state change
// the user needs to track frame-by-frame.
export function AnimatedCounter({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (latest) => Math.round(latest).toLocaleString("en-IN"));

  useEffect(() => {
    if (!inView) return;
    if (prefersReducedMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration: 1.2,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, value, prefersReducedMotion, motionValue]);

  return <motion.span ref={ref}>{rounded}</motion.span>;
}
