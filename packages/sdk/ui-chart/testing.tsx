// 차트 테스트 전용. 칸 폭을 정해 그리고 상태 입력의 기본값을 준다.
import type { ReactNode } from "react";
import { ResizeSourceProvider } from "@lophn/design/components";
import { manualResize, render } from "../../design/components/testing.ts";

export function sized(node: ReactNode, width = 640) {
  const resize = manualResize();
  const wrapped = (content: ReactNode) => (
    <ResizeSourceProvider value={resize}>{content}</ResizeSourceProvider>
  );
  const view = render(wrapped(node));
  resize.resize({ width, height: 240 });
  return {
    ...view,
    rerender(next: ReactNode) {
      view.rerender(wrapped(next));
      resize.resize({ width, height: 240 });
    },
  };
}

export const state = {
  onRetry: () => {},
  empty: {
    message: "No data yet.",
    action: { label: "Retry", onSelect: () => {} },
  },
  timeZone: "UTC",
};
