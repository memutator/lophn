import { useCallback, useSyncExternalStore } from "react";
import { READING_WIDTHS, type ReadingWidth } from "./model.ts";

// 전역 읽기 폭 선택의 저장은 platform settings가 맡는다. 이 interface로만 읽고 쓴다.
export interface ReadingWidthSetting {
  read(): ReadingWidth;
  write(width: ReadingWidth): void;
  subscribe(onChange: () => void): () => void;
}

export const DEFAULT_READING_WIDTH: ReadingWidth = "default";

// 저장된 값이 정한 세 폭이 아니면 기본 폭으로 읽는다.
export function readingWidthOf(value: unknown): ReadingWidth {
  return READING_WIDTHS.includes(value as ReadingWidth)
    ? value as ReadingWidth
    : DEFAULT_READING_WIDTH;
}

export function useReadingWidth(
  setting: ReadingWidthSetting,
): [ReadingWidth, (width: ReadingWidth) => void] {
  const width = useSyncExternalStore(
    setting.subscribe,
    () => readingWidthOf(setting.read()),
  );
  const change = useCallback(
    (next: ReadingWidth) => setting.write(next),
    [setting],
  );
  return [width, change];
}
