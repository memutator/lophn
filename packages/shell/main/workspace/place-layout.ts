// place(Home, project, app) layout 파일의 값. 파일 하나가 place 하나이고 desk 여럿을 가진다. 판 8부터다.
// 옛 `layouts/<prj_id>.json`(판 5~7)은 읽지 않는다. 파일이 없으면 기본 layout으로 시작한다.
// 상한과 불변 조건(tab key는 desk 안에서 한 번, selected·group의 leaf는 tabs 안, group은 leaf 2~4개이고 tabs에서
// leaf 순서로 붙어 있음)은 renderer shell/desk-model.ts와 짝이다.
import { z } from "zod";

import {
  DEFAULT_DESK,
  deskKey,
  layoutTabSchema,
  windowBounds,
} from "./schema.ts";
import { tabKindOf } from "./kinds/registry.ts";
import { tabKey } from "./kinds/values.ts";

export const PLACE_SCHEMA_VERSION = 8;

// 파일 이름이 되는 key라 폴더 밖으로 나갈 수 있는 글자(`.`, `/`, `\`)는 아예 받지 않는다.
export function isPlaceKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

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

// project의 빠른 실행. order는 단추 id의 순서, apps는 고정한 앱 panel 화면, hidden은 끈 단추 id다. 필드가 없으면 전역 값을 쓴다.
// 없어진 앱·모르는 id는 renderer가 그릴 때 건너뛰므로 여기서는 모양과 상한만 본다.
const quickSchema = z.strictObject({
  order: z.array(z.string().min(1).max(200)).max(64),
  apps: z
    .array(
      z.strictObject({
        app: z.string().min(1).max(64),
        surface: z.string().min(1).max(128),
      }),
    )
    .max(20),
  hidden: z.array(z.string().min(1).max(200)).max(64).optional(),
});

export const placeLayoutSchema = z
  .strictObject({
    schema_version: z.literal(PLACE_SCHEMA_VERSION),
    active_desk: deskKey,
    desks: z.record(deskKey, placeDeskSchema),
    quick: quickSchema.optional(),
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
 * 건너뛰고 고른 tab이 그 tab이면 고친다.
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
  return {
    ...desk,
    tabs: keptTabs,
    selected_tab:
      selected === null || keys.has(selected)
        ? selected
        : ((keptTabs[0] as { key?: unknown } | undefined)?.key ?? null),
    // 한쪽이 빠지면 짝만 남은 group은 의미가 없다.
    groups: groupsWithin(Array.isArray(desk.groups) ? desk.groups : [], keys),
    floats: floats.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
    detached: detached.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
  };
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
