// 페이지 틀의 폭 계산. CSS가 그리는 배치를 같은 token 값으로 계산해 칸 폭마다 확인한다.
import { tokens } from "../../../tokens.ts";
import { pixels } from "../../_shared/shared.ts";

export type ReadingWidth = keyof typeof tokens.page.reading;
export type TocPlacement = "side" | "head";
export type PanePadding = keyof typeof tokens.layout.panePadding;
export type ColumnFrame = "form";

export const READING_WIDTHS = Object.keys(
  tokens.page.reading,
) as ReadingWidth[];

export const TOC_WIDTH = pixels(tokens.page.toc);
// 본문과 목차 사이는 섹션 리듬의 48px다.
export const TOC_GAP = pixels(tokens.space[11]);

export function readingPixels(width: ReadingWidth): number {
  return pixels(tokens.page.reading[width]);
}

export function columnPixels(frame: ColumnFrame): number {
  return pixels(tokens.page[frame]);
}

// 칸 640px 미만은 양쪽 16px, 이상은 32px.
export function panePadding(pane: number): PanePadding {
  return pane < tokens.breakpoint.sm ? "narrow" : "wide";
}

export function panePaddingPixels(pane: number): number {
  return pixels(tokens.layout.panePadding[panePadding(pane)]);
}

// 목차를 본문 오른쪽에 붙이려면 안쪽 container가 본문+48+220 이상이어야 한다: 868·948·1068.
export function tocSideMinimum(width: ReadingWidth): number {
  return readingPixels(width) + TOC_GAP + TOC_WIDTH;
}

export function tocPlacement(inner: number, width: ReadingWidth): TocPlacement {
  return inner >= tocSideMinimum(width) ? "side" : "head";
}

export interface ColumnBox {
  readonly padding: number;
  readonly inner: number;
  readonly width: number;
  readonly left: number;
  readonly right: number;
}

// 최대폭 기둥은 칸 여백 안 가용 영역의 가운데에 둔다.
export function columnBox(pane: number, max: number): ColumnBox {
  const padding = panePaddingPixels(pane);
  const inner = Math.max(0, pane - padding * 2);
  const width = Math.min(max, inner);
  const left = padding + (inner - width) / 2;
  return { padding, inner, width, left, right: pane - left - width };
}

export interface ReadingBox extends ColumnBox {
  readonly toc: TocPlacement;
  readonly body: number;
}

// 목차가 옆이면 본문+간격+목차 묶음이 가운데 오고, 머리면 본문만 가운데 온다.
export function readingBox(pane: number, width: ReadingWidth): ReadingBox {
  const padding = panePaddingPixels(pane);
  const inner = Math.max(0, pane - padding * 2);
  const toc = tocPlacement(inner, width);
  const group =
    toc === "side"
      ? tocSideMinimum(width)
      : Math.min(readingPixels(width), inner);
  const body = toc === "side" ? readingPixels(width) : group;
  const left = padding + (inner - group) / 2;
  return {
    padding,
    inner,
    width: group,
    left,
    right: pane - left - group,
    toc,
    body,
  };
}
