// 앱 화면 탭의 머리 줄 통로. main을 거치지 않고 앱 view(`<webview>` guest)와 그것을 품은 shell renderer가
// 바로 주고받는다: 앱 preload가 `sendToHost`로 올리고 renderer는 그 element의 `ipc-message`로 받고, 누름은
// element의 `send`로 내려간다. 머리 줄은 그 탭 안의 표시일 뿐이라 신원이 필요 없고, 보낸 element가 곧 그 탭이다.
import {
  TAB_HEAD_ICONS,
  type TabHead,
  type TabHeadEvent,
  type TabHeadIcon,
  type TabHeadItem,
} from "../../protocol/shell/app-bridge-types.ts";

export type { TabHead, TabHeadEvent };

/** guest → host. 값은 `TabHead`나 null이고, 처음 붙을 때 preload가 `{ hello: true }`를 한 번 보낸다. */
export const APP_TAB_HEAD_CHANNEL = "app:tab-head";
/** host → guest. 값은 `TabHeadEvent`다. */
export const APP_TAB_HEAD_EVENT_CHANNEL = "app:tab-head-event";

const MAX_ITEMS = 24;
const MAX_CHARS = 80;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, MAX_CHARS);
}

function item(value: unknown): TabHeadItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id);
  const label = text(raw.label);
  if (id === undefined || label === undefined) return undefined;
  return raw.disabled === true ? { id, label, disabled: true } : { id, label };
}

function items(value: unknown): TabHeadItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ITEMS)
    .map(item)
    .filter((entry) => entry !== undefined);
}

/**
 * guest가 보낸 값을 그릴 수 있는 머리 줄로 읽는다. 앱 코드가 무엇을 보내도 shell은 글과 bool만 그리고(객체가
 * React child로 가면 창 전체가 깨진다), 모르는 칸·빈 글·넘친 항목은 버린다. 그릴 것이 없으면 null이다.
 */
export function readTabHead(value: unknown): TabHead | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const head: TabHead = {};
  const crumbs = Array.isArray(raw.crumbs)
    ? raw.crumbs
        .slice(0, MAX_ITEMS)
        .map(text)
        .filter((entry) => entry !== undefined)
    : [];
  if (crumbs.length > 0) head.crumbs = crumbs;
  const status = text(raw.status);
  if (status !== undefined) head.status = status;
  const tabs = raw.tabs as Record<string, unknown> | null | undefined;
  if (typeof tabs === "object" && tabs !== null) {
    const list = items(tabs.items);
    if (list.length > 0) {
      const selected = text(tabs.selected) ?? null;
      head.tabs = { items: list, selected };
    }
  }
  if (Array.isArray(raw.actions)) {
    const actions = raw.actions
      .slice(0, MAX_ITEMS)
      .map((entry) => {
        const base = item(entry);
        if (base === undefined) return undefined;
        const flags = entry as Record<string, unknown>;
        const icon = TAB_HEAD_ICONS.find((name) => name === flags.icon);
        return {
          ...base,
          ...(icon === undefined ? {} : { icon: icon satisfies TabHeadIcon }),
          ...(flags.primary === true ? { primary: true } : {}),
          ...(flags.busy === true ? { busy: true } : {}),
        };
      })
      .filter((entry) => entry !== undefined);
    if (actions.length > 0) head.actions = actions;
  }
  const menu = items(raw.menu);
  if (menu.length > 0) head.menu = menu;
  const nav = raw.nav as Record<string, unknown> | null | undefined;
  if (typeof nav === "object" && nav !== null) {
    head.nav = {
      canBack: nav.canBack === true,
      canForward: nav.canForward === true,
    };
  }
  return Object.keys(head).length === 0 ? null : head;
}
