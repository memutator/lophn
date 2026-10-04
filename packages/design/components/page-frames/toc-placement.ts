import { createContext, useContext } from "react";
import type { TocPlacement } from "./model.ts";

// ReadingFrame이 칸 폭으로 정한 목차 자리. 목차 컴포넌트는 이 값에 따라 옆 목록이나 머리 선택으로 그린다.
export const TocPlacementContext = createContext<TocPlacement>("side");

export function useTocPlacement(): TocPlacement {
  return useContext(TocPlacementContext);
}
