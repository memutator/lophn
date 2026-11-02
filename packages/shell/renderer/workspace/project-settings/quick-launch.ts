// 빠른 실행의 순서, 고정한 앱 panel, 끈 단추. 전역 값(`shell.quick_launch`)과 project layout의 `quick`이 같은 모양이다.
import type { PlaceQuick } from "../../shell/desk-model.ts";

const PINS_MAX = 20;

export const BUILTIN_QUICK = ["terminal", "browser", "app", "search"] as const;

export interface QuickPin {
  readonly app: string;
  readonly surface: string;
}

export const pinId = (pin: QuickPin): string => `pin:${pin.app}:${pin.surface}`;

const sameQuickPin = (a: QuickPin, b: QuickPin) =>
  a.app === b.app && a.surface === b.surface;

export const isPinned = (quick: PlaceQuick | undefined, pin: QuickPin) =>
  quick?.apps.some((item) => sameQuickPin(item, pin)) ?? false;

/** 보이는 순서의 id. 저장된 순서에서 모르는 id를 빼고, 순서에 없는 것(새로 생긴 단추·고정)은 기본 자리인 뒤에 붙인다. */
export function quickOrder(quick: PlaceQuick | undefined): string[] {
  const known = [...BUILTIN_QUICK, ...(quick?.apps ?? []).map(pinId)];
  const ordered = (quick?.order ?? []).filter(
    (id, at, all) => known.includes(id) && all.indexOf(id) === at,
  );
  return [...ordered, ...known.filter((id) => !ordered.includes(id))];
}

/** id를 delta칸(-1 위, +1 아래) 옮긴다. 끝이면 그대로다. */
export function moveQuick(
  quick: PlaceQuick | undefined,
  id: string,
  delta: -1 | 1,
): PlaceQuick {
  const order = quickOrder(quick);
  const at = order.indexOf(id);
  const to = at + delta;
  if (at >= 0 && to >= 0 && to < order.length) {
    [order[at], order[to]] = [order[to]!, order[at]!];
  }
  return { ...quick, order, apps: quick?.apps ?? [] };
}

export const isQuickHidden = (quick: PlaceQuick | undefined, id: string) =>
  quick?.hidden?.includes(id) ?? false;

/** 단추를 끄거나 켠다. 끈 단추도 순서에 남아 다시 켜면 그 자리로 돌아온다. */
export function setQuickHidden(
  quick: PlaceQuick | undefined,
  id: string,
  hidden: boolean,
): PlaceQuick {
  const rest = (quick?.hidden ?? []).filter((item) => item !== id);
  return {
    order: quickOrder(quick),
    apps: quick?.apps ?? [],
    hidden: hidden ? [...rest, id] : rest,
  };
}

/** 왼쪽 sidebar에 그릴 단추 id. 끈 것을 뺀 순서다. */
export function shownQuickOrder(quick: PlaceQuick | undefined): string[] {
  return quickOrder(quick).filter((id) => !isQuickHidden(quick, id));
}

export function setPinned(
  quick: PlaceQuick | undefined,
  pin: QuickPin,
  on: boolean,
): PlaceQuick {
  const apps = (quick?.apps ?? []).filter((item) => !sameQuickPin(item, pin));
  // main schema의 상한과 같다.
  if (on && apps.length >= PINS_MAX) return quick ?? { order: [], apps: [] };
  if (on) apps.push({ app: pin.app, surface: pin.surface });
  // 고정을 풀면 그 단추의 꺼짐 표시도 버린다.
  const hidden = (quick?.hidden ?? []).filter((id) => on || id !== pinId(pin));
  return {
    order: quickOrder({ order: quick?.order ?? [], apps }),
    apps,
    hidden,
  };
}
