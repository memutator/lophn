// 저장한 창 자리를 되살릴 때 지금 화면 안으로 당긴다. 모니터를 뺀 뒤 창이 화면 밖에 남지 않게 한다.
// desktop 창(`window-state.ts`)과 detached 창이 같이 쓴다.
import type { WindowBounds } from "../workspace/layout.ts";

const right = (b: WindowBounds) => b.x + b.width;
const bottom = (b: WindowBounds) => b.y + b.height;

function overlap(a: WindowBounds, b: WindowBounds): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * workAreas는 각 모니터의 작업 영역이다. 이미 한 영역 안에 들어 있으면 그대로 두고, 아니면 겹치는
 * 면적이 가장 큰 영역(없으면 첫 영역) 안으로 당긴다. 크기는 min 이상이고 영역보다 크지 않다.
 */
export function clampToWorkAreas(
  bounds: WindowBounds,
  workAreas: readonly WindowBounds[],
  min: { width: number; height: number },
): WindowBounds {
  const first = workAreas[0];
  if (first === undefined) return bounds;
  const fits = workAreas.some(
    (area) =>
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      right(bounds) <= right(area) &&
      bottom(bounds) <= bottom(area),
  );
  if (fits) return bounds;
  let area = first;
  let best = 0;
  for (const candidate of workAreas) {
    const size = overlap(bounds, candidate);
    if (size > best) {
      best = size;
      area = candidate;
    }
  }
  const width = Math.max(min.width, Math.min(bounds.width, area.width));
  const height = Math.max(min.height, Math.min(bounds.height, area.height));
  return {
    x: Math.max(area.x, Math.min(bounds.x, right(area) - width)),
    y: Math.max(area.y, Math.min(bounds.y, bottom(area) - height)),
    width,
    height,
  };
}
