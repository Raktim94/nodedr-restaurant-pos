import { toast as sonner } from "sonner";

// This app deliberately shows no success / info popups (they were removed in
// 1.3.0; confirmations are the page updating or an inline note). But a failed
// action must never be silent, so errors - and only errors - are shown.
//
// Call sites use `toast.success(...)` / `toast.error(...)` as before; only the
// import changed. To bring success popups back, make `success` call sonner.
const quiet = () => undefined;

export const toast = {
  error: (message: string, options?: Parameters<typeof sonner.error>[1]) =>
    sonner.error(message, { duration: 10_000, ...options }),
  success: quiet as (message: string) => void,
  info: quiet as (message: string, options?: unknown) => void,
  warning: quiet as (message: string) => void,
  dismiss: sonner.dismiss,
};
