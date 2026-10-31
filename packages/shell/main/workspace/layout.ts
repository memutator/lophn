// WorkspaceLayout의 검증과 기본값, 읽던 위치
// 보존의 순수 동작만 둔다. schema 원본은 schema.ts가 정한다.
import { z } from "zod";

import {
  LAYOUT_SCHEMA_VERSION,
  type LayoutFile,
  layoutFileSchema,
  type WorkspaceLayout,
  workspaceLayoutSchema,
} from "./schema.ts";
import { tabKindOf } from "./kinds/registry.ts";

export type {
  LayoutFile,
  LayoutNode,
  LayoutTab,
  WindowBounds,
  WorkspaceDesk,
  WorkspaceLayout,
} from "./schema.ts";
export { MAX_PANES } from "./schema.ts";

export const SCHEMA_VERSION = LAYOUT_SCHEMA_VERSION;

export type LayoutResult =
  | { ok: true; layout: WorkspaceLayout }
  | { ok: false; reason: "unsupported_schema" | "corrupt" };

/**
 * 파일에서 읽은 값을 검증한다. 미지원 schema와 손상은 안전한 오류로 빈 layout을
 * 가리킨다. 원본 파일은 바꾸지 않는다. 판 5(좌우 두 칸, `split_ratio`)와 판 6(`rail_apps` 없음)은 현재 판으로
 * 올려 읽는다. 쓰던 탭 배치를 잃지 않으려는 것이고, 다음 저장에서 현재 판 파일이 된다.
 */
export function parseLayoutFile(value: unknown): LayoutResult {
  if (
    typeof value === "object" &&
    value !== null &&
    "schema_version" in value &&
    typeof (value as { schema_version: unknown }).schema_version === "number"
  ) {
    const version = (value as { schema_version: number }).schema_version;
    if (version === 5) value = upgradeFromV6(upgradeFromV5(value));
    else if (version === 6) value = upgradeFromV6(value);
    else if (version !== SCHEMA_VERSION) {
      return { ok: false, reason: "unsupported_schema" };
    }
  }
  const parsed = layoutFileSchema.safeParse(skipUnregisteredTabs(value));
  if (!parsed.success) return { ok: false, reason: "corrupt" };
  return { ok: true, layout: parsed.data.layout };
}

// 판 6 파일에는 `rail_apps`가 없다. 맞지 않으면 그대로 돌려줘 schema 검증이 손상으로 판단한다.
function upgradeFromV6(file: unknown): unknown {
  const parsed = z.looseObject({ layout: z.looseObject({}) }).safeParse(file);
  if (!parsed.success) return file;
  return {
    ...parsed.data,
    schema_version: SCHEMA_VERSION,
    layout: {
      ...parsed.data.layout,
      schema_version: SCHEMA_VERSION,
      rail_apps: [],
    },
  };
}

// 판 5 파일의 모양. 칸은 하나거나 좌우 둘이었고, 둘이면 `split_ratio`가 왼쪽 몫이다.
const v5FileSchema = z.looseObject({
  layout: z.looseObject({
    desks: z.record(
      z.string(),
      z.looseObject({ panes: z.array(z.unknown()), split_ratio: z.unknown() }),
    ),
  }),
});

// 맞지 않으면 그대로 돌려줘 schema 검증이 손상으로 판단한다.
function upgradeFromV5(file: unknown): unknown {
  const parsed = v5FileSchema.safeParse(file);
  if (!parsed.success) return file;
  const { layout } = parsed.data;
  const desks = Object.fromEntries(
    Object.entries(layout.desks).map(
      ([name, { split_ratio: ratio, ...desk }]) => [
        name,
        {
          ...desk,
          layout:
            desk.panes.length === 2
              ? { dir: "row", ratio, a: "leaf", b: "leaf" }
              : "leaf",
        },
      ],
    ),
  );
  return {
    ...parsed.data,
    schema_version: 6,
    layout: { ...layout, schema_version: 6, desks },
  };
}

/**
 * registry에 없는 kind(지운 옛 kind 포함)의 탭은 자리마다 placeholder 없이 건너뛰고 나머지 탭의 순서·선택을
 * 지킨다. 선택 탭이 건너뛴 탭이면 첫 남은 탭으로 옮긴다. floated·detached 탭은 그 항목째 건너뛴다. 그 밖의
 * 모양 오류는 손대지 않고 schema 검증이 손상으로 판단한다.
 */
function skipUnregisteredTabs(value: unknown): unknown {
  const layout = (value as { layout?: unknown } | null)?.layout as
    | { desks?: unknown }
    | null
    | undefined;
  if (typeof layout !== "object" || layout === null) return value;
  const desks = layout.desks;
  if (typeof desks !== "object" || desks === null || Array.isArray(desks)) {
    return value;
  }
  let changed = false;
  const skipped: Record<string, unknown> = {};
  for (const [key, desk] of Object.entries(desks)) {
    const next = skipInDesk(desk);
    if (next !== desk) changed = true;
    skipped[key] = next;
  }
  if (!changed) return value;
  return { ...(value as object), layout: { ...layout, desks: skipped } };
}

function skipInDesk(value: unknown): unknown {
  const desk = value as {
    panes?: unknown;
    floats?: unknown;
    detached?: unknown;
  } | null;
  if (typeof desk !== "object" || desk === null) return value;
  const registered = (tab: unknown): boolean => {
    const kind = (tab as { kind?: unknown } | null)?.kind;
    return typeof kind !== "string" || tabKindOf(kind) !== undefined;
  };
  let changed = false;
  let panes = desk.panes;
  if (Array.isArray(panes)) {
    panes = panes.map((pane: unknown) => {
      const tabs = (pane as { tabs?: unknown } | null)?.tabs;
      if (!Array.isArray(tabs)) return pane;
      const kept = tabs.filter(registered);
      if (kept.length === tabs.length) return pane;
      changed = true;
      const selected = (pane as { selected_tab?: unknown }).selected_tab;
      const stillThere = kept.some(
        (tab: unknown) => (tab as { key?: unknown } | null)?.key === selected,
      );
      const first = (kept[0] as { key?: unknown } | undefined)?.key ?? null;
      return {
        ...(pane as object),
        tabs: kept,
        selected_tab: selected === null || stillThere ? selected : first,
      };
    });
  }
  let floats = desk.floats;
  if (Array.isArray(floats)) {
    const kept = floats.filter((float: unknown) =>
      registered((float as { tab?: unknown } | null)?.tab),
    );
    if (kept.length !== floats.length) {
      changed = true;
      floats = kept;
    }
  }
  let detached = desk.detached;
  if (Array.isArray(detached)) {
    const kept = detached.filter((item: unknown) =>
      registered((item as { tab?: unknown } | null)?.tab),
    );
    if (kept.length !== detached.length) {
      changed = true;
      detached = kept;
    }
  }
  if (!changed) return value;
  return { ...desk, panes, floats, detached };
}

/** file schema의 layout을 감싼다. */
export function toLayoutFile(layout: WorkspaceLayout): LayoutFile {
  return { schema_version: SCHEMA_VERSION, layout };
}

/** 저장 전 검증. 실패 원문 대신 안전한 이유만 내놓는다. */
export function validateLayout(value: unknown): LayoutResult {
  const parsed = workspaceLayoutSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "corrupt" };
  return { ok: true, layout: parsed.data };
}
