"use client";
import { createContext, useContext } from "react";
import type { StageKey } from "@/ui/types";

const StationNavContext = createContext<((key: StageKey) => void) | null>(null);

export const StationNavProvider = StationNavContext.Provider;

export function useStationNav(): (key: StageKey) => void {
  const go = useContext(StationNavContext);
  if (!go) throw new Error("useStationNav must be used inside <StationNavProvider>");
  return go;
}
