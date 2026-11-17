import type { AcpEntry, AcpItem, AcpToolBody, AcpToolItem } from "./items.ts";
import type {
  AcpChildState,
  AcpChildUpdate,
  AcpState,
  AcpUpdate,
} from "./state.ts";

// tool 본문(입력·출력)은 대화 상태와 따로 다닌다. 긴 대화의 snapshot은 대부분이 본문이라 frame 한도에 걸리고 그리기도 무겁다.
// harness GUI handle은 본문을 쥐고, 창과 core에 내는 snapshot·갱신에서는 빼며(`withoutToolBodies`, `updateWithoutToolBodies`),
// 화면은 줄을 펼칠 때 그 tool 하나의 본문을 handle에서 읽는다(`toolBodyOf`). lophn session은 처음부터 null이다.
// 사람이 친 명령(`by: "user"`)은 명령 글(`input`)만 남긴다: 화면이 명령 전체를 그 줄에 보인다.

function lean(item: AcpToolItem): AcpToolItem {
  if (item.body === null) return item;
  return {
    ...item,
    body:
      item.by === "user"
        ? { input: item.body.input, output: null, truncated: false }
        : null,
  };
}

function leanEntry<T extends AcpItem | AcpEntry>(item: T): T {
  if (item.kind === "tool") return lean(item) as T;
  if (item.kind === "hidden") {
    return { ...item, items: item.items.map(leanEntry) } as T;
  }
  return item;
}

function leanChild<T extends AcpChildState>(state: T): T {
  return { ...state, items: state.items.map(leanEntry) };
}

/** 본문을 뺀 상태. 자식 대화와 숨긴 구간 안까지 뺀다. */
export function withoutToolBodies(state: AcpState): AcpState {
  return {
    ...leanChild(state),
    children: Object.fromEntries(
      Object.entries(state.children).map(([key, child]) => [
        key,
        leanChild(child),
      ]),
    ),
  };
}

function leanChildUpdate(update: AcpChildUpdate): AcpChildUpdate {
  switch (update.type) {
    case "tool_started":
      return { ...update, item: lean(update.item) };
    // null은 "시작 때 본문을 그대로 둔다"라 사람 명령의 글도 남는다.
    case "tool_ended":
      return update.body === null ? update : { ...update, body: null };
    case "hidden_added":
      return { ...update, item: leanEntry(update.item) };
    default:
      return update;
  }
}

/** 본문을 뺀 갱신. */
export function updateWithoutToolBodies(update: AcpUpdate): AcpUpdate {
  if (update.type === "child_update") {
    return { ...update, update: leanChildUpdate(update.update) };
  }
  if (
    update.type === "tasks_changed" ||
    update.type === "draft_set" ||
    update.type === "session_reset"
  ) {
    return update;
  }
  return leanChildUpdate(update);
}

function bodyIn(
  items: readonly (AcpItem | AcpEntry)[],
  id: string,
): AcpToolBody | null | undefined {
  for (const item of items) {
    if (item.kind === "tool" && item.id === id) return item.body;
    if (item.kind === "hidden") {
      const inner = bodyIn(item.items, id);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/** 그 tool의 본문. 자식 대화와 숨긴 구간 안까지 찾는다. tool이 없거나 본문이 없으면 null이다. */
export function toolBodyOf(state: AcpState, id: string): AcpToolBody | null {
  for (const items of [
    state.items,
    ...Object.values(state.children).map((child) => child.items),
  ]) {
    const found = bodyIn(items, id);
    if (found !== undefined) return found;
  }
  return null;
}
