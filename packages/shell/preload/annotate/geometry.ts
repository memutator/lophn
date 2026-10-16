// 고른 곳의 위치 계산. viewport 비율과 scroll 값으로 적어 두고 다시 그릴 때 옮긴다.
import type { PickedItem } from "../../ipc/annotation.ts";

export type Rect = PickedItem["rect"];
/** viewport 안 사각형(CSS px). */
export type Box = { x: number; y: number; width: number; height: number };
export type View = {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
};

/** 번호 표지의 크기와 사각형 모서리에서 벗어난 만큼(CSS px). */
export const BADGE_SIZE = 22;
export const BADGE_OFFSET = 10;
const CROP_MARGIN = 16;

const unit = (value: number) => Math.min(1, Math.max(0, value));

export function rectOf(box: Box, view: View): Rect {
  return {
    x_ratio: unit(box.x / view.width),
    width_ratio: unit(box.width / view.width),
    y_px: box.y,
    height_px: box.height,
    scroll_x: view.scrollX,
    scroll_y: view.scrollY,
  };
}

/** 적어 둔 사각형을 지금 viewport와 scroll 값으로 옮긴다. */
export function boxOf(rect: Rect, view: View): Box {
  return {
    x: rect.x_ratio * view.width + rect.scroll_x - view.scrollX,
    y: rect.y_px + rect.scroll_y - view.scrollY,
    width: rect.width_ratio * view.width,
    height: rect.height_px,
  };
}

/** 고른 사각형과 번호 표지를 합친 것에 둘레 여백을 더하고 viewport 안으로 자른다. */
export function cropOf(box: Box, view: View): Box {
  const left = Math.min(box.x, box.x - BADGE_OFFSET) - CROP_MARGIN;
  const top = Math.min(box.y, box.y - BADGE_OFFSET) - CROP_MARGIN;
  const right = Math.max(box.x + box.width, box.x - BADGE_OFFSET + BADGE_SIZE) +
    CROP_MARGIN;
  const bottom =
    Math.max(box.y + box.height, box.y - BADGE_OFFSET + BADGE_SIZE) +
    CROP_MARGIN;
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  return {
    x,
    y,
    width: Math.max(0, Math.min(view.width, right) - x),
    height: Math.max(0, Math.min(view.height, bottom) - y),
  };
}
