"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DemoInfo { demo: boolean; resetEveryHours?: number; nextResetAt?: string }
/** Whether this server is the public demo (and when it next resets). A normal server answers { demo: false }. */
export const useDemoInfo = () =>
  useQuery({ queryKey: ["demo-info"], queryFn: () => api.get<DemoInfo>("/public/demo-info"), staleTime: 5 * 60_000, retry: false });
