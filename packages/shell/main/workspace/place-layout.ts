// place(Home, project, app) layout 파일의 값. 파일 하나가 place 하나이고 desk 여럿을 가진다. 판 8부터다.
// 판 7 이하의 project layout(`layouts/<prj_id>.json`)은 읽기만 하고 판 8로 올려 돌려준다(`upgradeFromV7`).
// 상한과 불변 조건(tab key는 desk 안에서 한 번, selected·group의 leaf는 tabs 안, group은 leaf 2~4개이고 tabs에서
// leaf 순서로 붙어 있음)은 renderer shell/desk-model.ts와 짝이다.
import { z } from "zod";

import {
  DEFAULT_DESK,
  deskKey,
  layoutTabSchema,
  windowBounds,
} from "./schema.ts";
import type {
  LayoutNode,
  LayoutTab,
  WorkspaceDesk,
  WorkspaceLayout,
} from "./schema.ts";
import { tabKindOf } from "./kinds/registry.ts";
import { tabKey } from "./kinds/values.ts";

export const PLACE_SCHEMA_VERSION = 8;

// 파일 이름이 되는 key라 폴더 밖으로 나갈 수 있는 글자(`.`, `/`, `\`)는 아예 받지 않는다.
export function isPlaceKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

// 옛 칸 6개의 tab을 한 줄로 합쳐도 잃지 않는 크기(6 × 200).
const TABS_MAX = 1200;

// group의 배치 tree. leaf는 tab key, 나눔은 row(a가 왼쪽)나 column(a가 위)이고 ratio는 a의 몫이다.
export type StoredNode =
  | { tab: string }
  | { dir: "row" | "column"; ratio: number; a: StoredNode; b: StoredNode };

const nodeSchema: z.ZodType<StoredNode> = z.lazy(() =>
  z.union([
    z.strictObject({ tab: tabKey }),
    z.strictObject({
      dir: z.enum(["row", "column"]),
      ratio: z.number().min(0.15).max(0.85),
      a: nodeSchema,
      b: nodeSchema,
    }),
  ]),
);

type StoredGroup = { layout: StoredNode; focus: string };

export function leavesOf(node: StoredNode): string[] {
  return "tab" in node
    ? [node.tab]
    : [...leavesOf(node.a), ...leavesOf(node.b)];
}

const groupSchema = z
  .strictObject({ layout: nodeSchema, focus: tabKey })
  .refine(
    (group) => {
      const count = leavesOf(group.layout).length;
      return count >= 2 && count <= 4;
    },
    { message: "a group has 2 to 4 leaves" },
  )
  .refine((group) => leavesOf(group.layout).includes(group.focus), {
    message: "group focus is not a leaf",
  });

const placeDeskSchema = z
  .strictObject({
    label: z.string().min(1).max(200),
    workflow: z.string().min(1).max(200).optional(),
    tabs: z.array(layoutTabSchema).max(TABS_MAX),
    selected_tab: tabKey.nullable(),
    // 초기 개발 파일에는 없다. 없으면 group이 없다.
    groups: z.array(groupSchema).default([]),
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
      const keys = desk.tabs.map((tab) => tab.key);
      const used = new Set<string>();
      for (const group of desk.groups) {
        const leaves = leavesOf(group.layout);
        const at = keys.indexOf(leaves[0]!);
        // leaf가 모두 tabs에 leaf 순서대로 붙어 있고 다른 group에 들지 않는다.
        if (at < 0 || leaves.some((leaf, i) => keys[at + i] !== leaf)) {
          return false;
        }
        if (leaves.some((leaf) => used.has(leaf))) return false;
        for (const leaf of leaves) used.add(leaf);
      }
      return true;
    },
    { message: "group leaves are not adjacent tabs in leaf order" },
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
  const { split: _split, ...rest } = desk;
  return {
    ...rest,
    tabs: keptTabs,
    selected_tab:
      selected === null || keys.has(selected)
        ? selected
        : ((keptTabs[0] as { key?: unknown } | undefined)?.key ?? null),
    // 한쪽이 빠지면 짝만 남은 group은 의미가 없다.
    groups: groupsWithin(storedGroups(desk), keys),
    floats: floats.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
    detached: detached.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
  };
}

// 판 8 초기 개발 파일은 group 대신 `split {a, b, focus, dir?, ratio?}` 하나를 가졌다. 읽을 때 group 하나로 읽는다.
function storedGroups(desk: Record<string, unknown>): unknown[] {
  if (Array.isArray(desk.groups)) return desk.groups;
  const split = desk.split as Record<string, unknown> | null | undefined;
  if (typeof split !== "object" || split === null) return [];
  return [
    {
      layout: {
        dir: split.dir ?? "row",
        ratio: split.ratio ?? 0.5,
        a: { tab: split.a },
        b: { tab: split.b },
      },
      focus: split.focus === "b" ? split.b : split.a,
    },
  ];
}

const leavesIn = (node: unknown): unknown[] => {
  const value = node as { tab?: unknown; a?: unknown; b?: unknown } | null;
  if (typeof value !== "object" || value === null) return [];
  return "tab" in value
    ? [value.tab]
    : [...leavesIn(value.a), ...leavesIn(value.b)];
};

// 등록된 tab만 남은 tabs 안에서 leaf를 걷어내고, 2개 미만이 된 group은 버린다. 모양이 틀린 group은 그대로 둬서 schema가 거절한다.
function groupsWithin(
  groups: unknown[],
  keys: ReadonlySet<unknown>,
): unknown[] {
  const prune = (node: unknown): unknown => {
    const value = node as { tab?: unknown; a?: unknown; b?: unknown } | null;
    if (typeof value !== "object" || value === null) return node;
    if ("tab" in value) return keys.has(value.tab) ? node : null;
    const a = prune(value.a);
    const b = prune(value.b);
    if (a === null) return b;
    if (b === null) return a;
    return a === value.a && b === value.b ? node : { ...value, a, b };
  };
  return groups.flatMap((group) => {
    const value = group as { layout?: unknown; focus?: unknown } | null;
    if (typeof value !== "object" || value === null) return [group];
    const layout = prune(value.layout);
    if (layout === null) return [];
    const leaves = leavesIn(layout);
    if (leaves.length === 0) return [group];
    if (leaves.length < 2) return [];
    return [
      {
        ...value,
        layout,
        focus: leaves.includes(value.focus as string) ? value.focus : leaves[0],
      },
    ];
  });
}

/**
 * 칸 2~4개(모두 tab이 있음)인 옛 desk를 group 하나로 바꾼다. leaf는 칸의 고른 tab(이미 다른 칸의 leaf면 그 칸의
 * 다음 tab)이고 배치 tree는 칸 tree 그대로다. 안 되는 desk는 null이다(칸이 1개거나 5개 이상, 빈 칸, leaf를 못 고름).
 */
function groupOfPanes(
  desk: WorkspaceDesk,
): { leaves: LayoutTab[]; group: StoredGroup } | null {
  const { panes } = desk;
  if (panes.length < 2 || panes.length > 4) return null;
  const used = new Set<string>();
  const leaves: LayoutTab[] = [];
  for (const pane of panes) {
    const picked = [
      pane.tabs.find((tab) => tab.key === pane.selected_tab),
      ...pane.tabs,
    ].find((tab) => tab !== undefined && !used.has(tab.key));
    if (picked === undefined) return null;
    used.add(picked.key);
    leaves.push(picked);
  }
  let next = 0;
  const build = (node: LayoutNode): StoredNode => {
    if (node === "leaf") return { tab: leaves[next++]!.key };
    const a = build(node.a);
    const b = build(node.b);
    return {
      dir: node.dir,
      ratio: Math.min(0.85, Math.max(0.15, node.ratio)),
      a,
      b,
    };
  };
  const layout = build(desk.layout);
  return {
    leaves,
    group: {
      layout,
      focus: (leaves[desk.focused_pane] ?? leaves[0]!).key,
    },
  };
}

/**
 * 판 7 project layout을 판 8로 올린다. 칸이 2~4개이고 모두 tab이 있으면 칸 tree 그대로 group 하나로 올린다
 * (leaf = 칸의 고른 tab, focus = focus 칸의 고른 tab). tabs는 group의 tab이 leaf 순서로 맨 앞에 서고 나머지가
 * 칸 순서(왼쪽·위에서부터)로 뒤따른다. 그 밖에는 칸의 tab을 칸 순서로 한 줄에 합친다. 같은 key는 처음 것만
 * 남긴다(float·detached 포함). 고른 tab은 group이면 focus, 아니면 focus 칸의 선택이고 없으면 첫 tab이다. float의
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
      const grouped = groupOfPanes(desk);
      const lead = (grouped?.leaves ?? []).filter(fresh);
      const tabs = [
        ...lead,
        ...desk.panes.flatMap((pane) => pane.tabs).filter(fresh),
      ];
      const focused =
        grouped?.group.focus ??
        desk.panes[desk.focused_pane]?.selected_tab ??
        null;
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
          groups: grouped === null ? [] : [grouped.group],
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
