import { tokens } from "@lophn/ui";

// 앱 화면이 놓인 container의 크기 종류. 창이 아니라 실제로 넣은 영역의 폭으로 정한다.
export type ContainerSpace = "card" | "panel" | "full";

const PANEL = Number.parseFloat(tokens.layout.container.panel);

// 320px 미만은 카드, 640px 미만은 패널, 그 이상은 전체다. 카드는 240px부터 지원한다.
export function containerSpace(width: number): ContainerSpace {
  if (width < PANEL) return "card";
  if (width < tokens.breakpoint.sm) return "panel";
  return "full";
}
