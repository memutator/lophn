// place(Home, project, app) layout 파일의 값. 파일 하나가 place 하나이고 desk 여럿을 가진다. 판 8부터다.
// 판 7 이하의 project layout(`layouts/<prj_id>.json`)은 읽기만 하고 판 8로 올려 돌려준다(`upgradeFromV7`).
// 상한과 불변 조건(tab key는 desk 안에서 한 번, selected·split은 tabs 안, split의 a·b는 붙어 있음)은 renderer
// shell/desk-model.ts와 짝이다.
import { z } from "zod";

import {
  DEFAULT_DESK,
  deskKey,
  layoutTabSchema,
  windowBounds,
} from "./schema.ts";
import type { LayoutTab, WorkspaceLayout } from "./schema.ts";
import { tabKindOf } from "./kinds/registry.ts";
import { tabKey } from "./kinds/values.ts";

export const PLACE_SCHEMA_VERSION = 8;

// 파일 이름이 되는 key라 폴더 밖으로 나갈 수 있는 글자(`.`, `/`, `\`)는 아예 받지 않는다.
export function isPlaceKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

// 옛 칸 6개의 tab을 한 줄로 합쳐도 잃지 않는 크기(6 × 200).
const TABS_MAX = 1200;

const placeDeskSchema = z
  .strictObject({
    label: z.string().min(1).max(200),
    workflow: z.string().min(1).max(200).optional(),
    tabs: z.array(layoutTabSchema).max(TABS_MAX),
    selected_tab: tabKey.nullable(),
    split: z
      .strictObject({
        a: tabKey,
        b: tabKey,
        focus: z.enum(["a", "b"]),
        // 판 8 초기 개발 파일에는 없다. 없으면 좌우 반반이다.
        dir: z.enum(["row", "column"]).default("row"),
        ratio: z.number().min(0.15).max(0.85).default(0.5),
      })
      .nullable(),
    floats: z
      .array(
        z.strictObject({
          tab: layoutTabSchema,
          rect: windowBounds,
          minimized: z.boolean(),
        }),
      )
      .max(20),
    detached: z
      .array(z.strictObject({ tab: layoutTabSchema, bounds: windowBounds }))
      .max(20),
  })
  .refine(
    (desk) => {
      const keys = [
        ...desk.tabs.map((tab) => tab.key),
        ...desk.floats.map((item) => item.tab.key),
        ...desk.detached.map((item) => item.tab.key),
      ];
      return new Set(keys).size === keys.length;
    },
    { message: "a tab key appears twice in the desk" },
  )
  .refine(
    (desk) =>
      desk.selected_tab === null ||
      desk.tabs.some((tab) => tab.key === desk.selected_tab),
    { message: "selected_tab is not in tabs" },
  )
  .refine(
    (desk) => {
      if (desk.split === null) return true;
      const { a, b } = desk.split;
      const at = desk.tabs.findIndex((tab) => tab.key === a);
      return at >= 0 && desk.tabs[at + 1]?.key === b;
    },
    { message: "split a and b are not adjacent tabs" },
  );

export type PlaceDesk = z.infer<typeof placeDeskSchema>;

export const placeLayoutSchema = z
  .strictObject({
    schema_version: z.literal(PLACE_SCHEMA_VERSION),
    active_desk: deskKey,
    desks: z.record(deskKey, placeDeskSchema),
  })
  .refine(
    (layout) => {
      const count = Object.keys(layout.desks).length;
      return count >= 1 && count <= 200;
    },
    { message: "desks must have 1 to 200 entries" },
  )
  .refine((layout) => Object.hasOwn(layout.desks, DEFAULT_DESK), {
    message: "desks has no main desk",
  })
  .refine((layout) => Object.hasOwn(layout.desks, layout.active_desk), {
    message: "active_desk is not in desks",
  });

export type PlaceLayoutValue = z.infer<typeof placeLayoutSchema>;

export type PlaceLayoutResult =
  | { ok: true; layout: PlaceLayoutValue }
  | { ok: false; reason: "unsupported_schema" | "corrupt" };

/**
 * 파일에서 읽은 값을 검증한다. 다른 판은 이 판으로 읽지 않고 파일은 그대로 둔다. registry에 없는 kind의 tab은
 * 건너뛰고 고른 tab·split이 그 tab이면 고친다.
 */
export function parsePlaceLayoutFile(value: unknown): PlaceLayoutResult {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;
  if (typeof version === "number" && version !== PLACE_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported_schema" };
  }
  const parsed = placeLayoutSchema.safeParse(skipUnregisteredTabs(value));
  return parsed.success
    ? { ok: true, layout: parsed.data }
    : { ok: false, reason: "corrupt" };
}

/** 저장 전 검증. renderer가 보낸 값에 판을 붙여 검사한다. */
export function validatePlaceLayout(value: unknown): PlaceLayoutResult {
  const parsed = placeLayoutSchema.safeParse({
    ...(value as object),
    schema_version: PLACE_SCHEMA_VERSION,
  });
  return parsed.success
    ? { ok: true, layout: parsed.data }
    : { ok: false, reason: "corrupt" };
}

const registered = (tab: unknown): boolean => {
  const kind = (tab as { kind?: unknown } | null)?.kind;
  return typeof kind !== "string" || tabKindOf(kind) !== undefined;
};

function skipUnregisteredTabs(value: unknown): unknown {
  const desks = (value as { desks?: unknown } | null)?.desks;
  if (typeof desks !== "object" || desks === null || Array.isArray(desks)) {
    return value;
  }
  const fixed = Object.fromEntries(
    Object.entries(desks).map(([key, desk]) => [key, skipInDesk(desk)]),
  );
  return { ...(value as object), desks: fixed };
}

function skipInDesk(value: unknown): unknown {
  const desk = value as Record<string, unknown> | null;
  if (typeof desk !== "object" || desk === null) return value;
  const { tabs, floats, detached } = desk;
  if (
    !Array.isArray(tabs) ||
    !Array.isArray(floats) ||
    !Array.isArray(detached)
  ) {
    return value;
  }
  const keptTabs = tabs.filter(registered);
  const keys = new Set(keptTabs.map((tab: { key?: unknown }) => tab?.key));
  const selected = desk.selected_tab;
  const split = desk.split as { a?: unknown; b?: unknown } | null | undefined;
  return {
    ...desk,
    tabs: keptTabs,
    selected_tab:
      selected === null || keys.has(selected)
        ? selected
        : ((keptTabs[0] as { key?: unknown } | undefined)?.key ?? null),
    // 한쪽이 빠지면 짝만 남은 split은 의미가 없다.
    split: split && keys.has(split.a) && keys.has(split.b) ? split : null,
    floats: floats.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
    detached: detached.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
  };
}

/**
 * 판 7 project layout을 판 8로 올린다. 칸들의 tab을 칸 순서(왼쪽·위에서부터)로 한 줄에 합치고, 같은 key는 처음
 * 것만 남긴다(float·detached 포함). 고른 tab은 focus 칸의 선택이고 없으면 첫 tab이다. split은 없다. float의
 * `origin_pane`·`docked_at`과 `rail_apps`는 버린다. workflow desk의 key는 workflow 이름(slug)이라 label과 workflow가
 * 그 이름이다.
 */
export function upgradeFromV7(old: WorkspaceLayout): PlaceLayoutResult {
  const desks = Object.fromEntries(
    Object.entries(old.desks).map(([key, desk]) => {
      const seen = new Set<string>();
      const fresh = (tab: LayoutTab) => {
        if (seen.has(tab.key)) return false;
        seen.add(tab.key);
        return true;
      };
      const tabs = desk.panes.flatMap((pane) => pane.tabs).filter(fresh);
      const focused = desk.panes[desk.focused_pane]?.selected_tab ?? null;
      const main = key === DEFAULT_DESK;
      return [
        key,
        {
          label: main ? "Main" : key,
          ...(main ? {} : { workflow: key }),
          tabs,
          selected_tab: tabs.some((tab) => tab.key === focused)
            ? focused
            : (tabs[0]?.key ?? null),
          split: null,
          floats: desk.floats
            .filter((item) => fresh(item.tab))
            .map(({ tab, rect, minimized }) => ({ tab, rect, minimized })),
          detached: desk.detached.filter((item) => fresh(item.tab)),
        },
      ];
    }),
  );
  const parsed = placeLayoutSchema.safeParse({
    schema_version: PLACE_SCHEMA_VERSION,
    active_desk: old.active_desk,
    desks,
  });
  return parsed.success
    ? { ok: true, layout: parsed.data }
    : { ok: false, reason: "corrupt" };
}
