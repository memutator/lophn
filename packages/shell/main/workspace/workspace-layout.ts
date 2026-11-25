// workspace(Home, project, app) layout 파일의 값. 파일 하나가 workspace 하나이고 desk 여럿을 가진다. 판 13이다(판 10은 core의
// data step `shell.layout-machines`가 11로, 판 11은 `shell.layout-owners`가 12로, 판 12는 `shell.layout-groups`가 13으로 판만
// 올린다: 판 11은 탭 공통 칸 `machine`을, 판 12는 공통 칸 `owner`·`handed_tab`을, 판 13은 group의 선택 칸 `group_id`·`label`·
// `collapsed`와 leaf 하나짜리 bundle group을 더했을 뿐이라 옛 값은 그대로다). 다른 판은 읽지 않는다.
// Agent·터미널 탭은 저장하지 않는다(renderer의 창 메모리에만 산다). 여기 kind가 없고 옛 파일에 남아 있어도 읽을 때 건너뛴다.
// 파일이 없으면 기본 layout으로 시작한다.
// 상한과 불변 조건(tab key는 desk 안에서 한 번, selected·group의 leaf는 tabs 안, group은 leaf 2~4개이거나 leaf 1개에
// tab 둘 이상이 쌓인 bundle이고 tabs에서 leaf 순서로 붙어 있고 칸에 숨은 tab이 그 바로 뒤에 붙어 있음)은 renderer
// shell/desk-model.ts와 짝이다.
import { z } from "zod";
import { tabKindOf } from "./kinds/registry.ts";
import { idOf, tabKey } from "./kinds/values.ts";
import {
  DEFAULT_DESK,
  deskKey,
  layoutTabSchema,
  windowBounds,
} from "./schema.ts";

export const WORKSPACE_SCHEMA_VERSION = 14;
export const LEGACY_COMMAND_LAYOUT_VERSION = 13;

// 파일 이름이 되는 key라 폴더 밖으로 나갈 수 있는 글자(`.`, `/`, `\`)는 아예 받지 않는다.
export function isWorkspaceKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

const TABS_MAX = 1200;

// group의 배치 tree. leaf는 칸(보이는 tab key와, 돌려 보는 tab이 둘 이상이면 온 순서의 stack), 나눔은 row(a가
// 왼쪽)나 column(a가 위)이고 ratio는 a의 몫이다. stack은 선택 필드라 없어도 맞다.
export type StoredNode =
  | { tab: string; stack?: string[] | undefined }
  | { dir: "row" | "column"; ratio: number; a: StoredNode; b: StoredNode };

const leafSchema = z
  .strictObject({
    tab: tabKey,
    stack: z.array(tabKey).min(2).max(TABS_MAX).optional(),
  })
  .refine(
    (leaf) =>
      leaf.stack === undefined ||
      (leaf.stack.includes(leaf.tab) &&
        new Set(leaf.stack).size === leaf.stack.length),
    { message: "a pane stack holds its tab once" },
  );

const nodeSchema: z.ZodType<StoredNode> = z.lazy(() =>
  z.union([
    leafSchema,
    z.strictObject({
      dir: z.enum(["row", "column"]),
      ratio: z.number().min(0.15).max(0.85),
      a: nodeSchema,
      b: nodeSchema,
    }),
  ]),
);

export function leavesOf(node: StoredNode): string[] {
  return "tab" in node
    ? [node.tab]
    : [...leavesOf(node.a), ...leavesOf(node.b)];
}

// 칸에 숨은 tab들(leaf 순서, 칸 안에서는 온 순서).
function hiddenOf(node: StoredNode): string[] {
  return "tab" in node
    ? (node.stack ?? []).filter((key) => key !== node.tab)
    : [...hiddenOf(node.a), ...hiddenOf(node.b)];
}

const groupSchema = z
  .strictObject({
    layout: nodeSchema,
    focus: tabKey,
    // 자동으로 묶는 쪽이 같은 묶음을 찾는 key, 탭 줄 머리글, 탭 줄에서 접힘. 판 13에서 더한 선택 필드다.
    group_id: z.string().min(1).max(200).optional(),
    label: z.string().min(1).max(200).optional(),
    collapsed: z.literal(true).optional(),
  })
  .refine(
    (group) => {
      const count = leavesOf(group.layout).length;
      // leaf 하나는 칸에 tab 둘 이상이 쌓인 bundle일 때만이다(stack은 늘 둘 이상이다).
      return (
        (count >= 2 && count <= 4) ||
        (count === 1 && hiddenOf(group.layout).length > 0)
      );
    },
    { message: "a group has 2 to 4 leaves or one stacked leaf" },
  )
  .refine((group) => leavesOf(group.layout).includes(group.focus), {
    message: "group focus is not a leaf",
  });

const workspaceDeskSchema = z
  .strictObject({
    label: z.string().min(1).max(200),
    workflow: z.string().min(1).max(200).optional(),
    // workflow instance 전용 desk면 그 instance id(`wfi_...`)다. 판 14 안에서 더한 선택 필드라 없는 옛 파일은 정의 desk다.
    workflow_instance: z
      .string()
      .refine((value) => idOf("wfi", value) !== null)
      .optional(),
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
          // 고정(always on top). 판 9 안에서 더한 선택 필드라 없는 옛 파일은 고정 안 함이다.
          pinned: z.literal(true).optional(),
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
        const members = [...leavesOf(group.layout), ...hiddenOf(group.layout)];
        const at = keys.indexOf(members[0]!);
        // leaf가 모두 tabs에 leaf 순서대로 붙어 있고 칸에 숨은 tab이 그 뒤에 붙으며, 다른 group에 들지 않는다.
        if (at < 0 || members.some((key, i) => keys[at + i] !== key)) {
          return false;
        }
        if (members.some((key) => used.has(key))) return false;
        for (const key of members) used.add(key);
      }
      return true;
    },
    { message: "group leaves are not adjacent tabs in leaf order" },
  )
  .refine(
    (desk) =>
      !desk.groups.some((group) =>
        hiddenOf(group.layout).includes(desk.selected_tab ?? ""),
      ),
    { message: "selected_tab is hidden in a pane" },
  );

export type WorkspaceDesk = z.infer<typeof workspaceDeskSchema>;

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

// 판 13 layout의 옛 project 명령. shell main이 읽을 때 core(`project_commands/import`)로 옮기고 판 14에서 지운다.
const legacyCommandSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  command: z.string().min(1).max(1000),
});
export type LegacyQuickCommand = z.infer<typeof legacyCommandSchema>;

const layoutBaseFields = {
  active_desk: deskKey,
  desks: z.record(deskKey, workspaceDeskSchema),
  quick: quickSchema.optional(),
};

function withLayoutInvariants<
  T extends z.ZodType<{
    active_desk: string;
    desks: Record<string, WorkspaceDesk>;
  }>,
>(schema: T) {
  return schema
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
}

export const workspaceLayoutSchema = withLayoutInvariants(
  z.strictObject({
    schema_version: z.literal(WORKSPACE_SCHEMA_VERSION),
    ...layoutBaseFields,
  }),
);

const legacyV13LayoutSchema = withLayoutInvariants(
  z.strictObject({
    schema_version: z.literal(LEGACY_COMMAND_LAYOUT_VERSION),
    ...layoutBaseFields,
    commands: z.array(legacyCommandSchema).max(20).optional(),
  }),
);

export type WorkspaceLayoutValue = z.infer<typeof workspaceLayoutSchema>;

export type WorkspaceLayoutResult =
  | { ok: true; layout: WorkspaceLayoutValue }
  | { ok: false; reason: "unsupported_schema" | "corrupt" };

/** 판 13 layout을 검증하고 판 14 layout과 옮길 옛 명령 목록으로 나눈다. 모양이 틀리면 null이다. */
export function parseLegacyV13Layout(value: unknown): {
  layout: WorkspaceLayoutValue;
  commands: LegacyQuickCommand[];
} | null {
  const parsed = legacyV13LayoutSchema.safeParse(skipUnregisteredTabs(value));
  if (!parsed.success) return null;
  const { commands, schema_version: _v13, ...rest } = parsed.data;
  return {
    layout: { ...rest, schema_version: WORKSPACE_SCHEMA_VERSION },
    commands: commands ?? [],
  };
}

/**
 * 파일에서 읽은 값을 검증한다. 다른 판은 이 판으로 읽지 않고 파일은 그대로 둔다. registry에 없는 kind의 tab은
 * 건너뛰고 고른 tab이 그 tab이면 고친다.
 */
export function parseWorkspaceLayoutFile(
  value: unknown,
): WorkspaceLayoutResult {
  const version = (value as { schema_version?: unknown } | null)
    ?.schema_version;
  if (typeof version === "number" && version !== WORKSPACE_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported_schema" };
  }
  const parsed = workspaceLayoutSchema.safeParse(skipUnregisteredTabs(value));
  return parsed.success
    ? { ok: true, layout: parsed.data }
    : { ok: false, reason: "corrupt" };
}

/** 저장 전 검증. renderer가 보낸 값에 판을 붙여 검사한다. */
export function validateWorkspaceLayout(value: unknown): WorkspaceLayoutResult {
  const parsed = workspaceLayoutSchema.safeParse({
    ...(value as object),
    schema_version: WORKSPACE_SCHEMA_VERSION,
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
  // 한쪽이 빠지면 짝만 남은 group은 의미가 없다.
  const groups = groupsWithin(
    Array.isArray(desk.groups) ? desk.groups : [],
    keys,
  );
  const finalTabs =
    keptTabs.length === tabs.length ? tabs : glued(keptTabs, groups);
  const hidden = new Set(
    groups.flatMap((group) =>
      hiddenIn((group as { layout?: unknown } | null)?.layout),
    ),
  );
  const visibleSelected =
    selected === null || (keys.has(selected) && !hidden.has(selected))
      ? selected
      : ((
          finalTabs.find(
            (tab) => !hidden.has((tab as { key?: unknown } | null)?.key),
          ) as { key?: unknown } | undefined
        )?.key ?? null);
  return {
    ...desk,
    tabs: finalTabs,
    selected_tab: visibleSelected,
    groups,
    floats: floats.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
    detached: detached.filter((item: { tab?: unknown } | null) =>
      registered(item?.tab),
    ),
  };
}

// 칸의 보이던 tab이 빠져 stack의 이웃이 보이면 group의 tab이 떨어질 수 있다. 첫 구성원 자리에 다시 붙인다.
function glued(tabs: unknown[], groups: unknown[]): unknown[] {
  const keyOf = (tab: unknown) => (tab as { key?: unknown } | null)?.key;
  const owner = new Map<unknown, unknown[]>();
  for (const group of groups) {
    const layout = (group as { layout?: unknown } | null)?.layout;
    const members = [...leavesIn(layout), ...hiddenIn(layout)];
    for (const key of members) owner.set(key, members);
  }
  const byKey = new Map(tabs.map((tab) => [keyOf(tab), tab]));
  const done = new Set<unknown[]>();
  return tabs.flatMap((tab) => {
    const members = owner.get(keyOf(tab));
    if (members === undefined) return [tab];
    if (done.has(members)) return [];
    done.add(members);
    return members.flatMap((key) => (byKey.has(key) ? [byKey.get(key)] : []));
  });
}

// 칸의 stack에서 빠진 tab을 걷어낸다. 보이던 tab이 빠지면 stack의 이웃이 보이고, 칸이 비면 null이다.
function pruneLeaf(
  value: { tab?: unknown; stack?: unknown },
  keys: ReadonlySet<unknown>,
): unknown {
  if (!Array.isArray(value.stack)) return keys.has(value.tab) ? value : null;
  const all: unknown[] = value.stack;
  const stack = all.filter((key) => keys.has(key));
  if (stack.length === all.length) return value;
  if (stack.length === 0) return null;
  const at = all.indexOf(value.tab);
  const tab = keys.has(value.tab)
    ? value.tab
    : (all.slice(at + 1).find((key) => keys.has(key)) ??
      all.slice(0, at).findLast((key) => keys.has(key)));
  const { stack: _old, ...rest } = value;
  return stack.length < 2 ? { ...rest, tab } : { ...rest, tab, stack };
}

const leavesIn = (node: unknown): unknown[] => {
  const value = node as { tab?: unknown; a?: unknown; b?: unknown } | null;
  if (typeof value !== "object" || value === null) return [];
  return "tab" in value
    ? [value.tab]
    : [...leavesIn(value.a), ...leavesIn(value.b)];
};

const hiddenIn = (node: unknown): unknown[] => {
  const value = node as {
    tab?: unknown;
    stack?: unknown;
    a?: unknown;
    b?: unknown;
  } | null;
  if (typeof value !== "object" || value === null) return [];
  if (!("tab" in value)) return [...hiddenIn(value.a), ...hiddenIn(value.b)];
  return Array.isArray(value.stack)
    ? value.stack.filter((key) => key !== value.tab)
    : [];
};

// 등록된 tab만 남은 tabs 안에서 leaf를 걷어내고, leaf 1개에 tab 하나만 남은 group은 버린다. 모양이 틀린 group은 그대로 둬서 schema가 거절한다.
function groupsWithin(
  groups: unknown[],
  keys: ReadonlySet<unknown>,
): unknown[] {
  const prune = (node: unknown): unknown => {
    const value = node as { tab?: unknown; a?: unknown; b?: unknown } | null;
    if (typeof value !== "object" || value === null) return node;
    if ("tab" in value) return pruneLeaf(value, keys);
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
    if (leaves.length < 2 && hiddenIn(layout).length === 0) return [];
    return [
      {
        ...value,
        layout,
        focus: leaves.includes(value.focus as string) ? value.focus : leaves[0],
      },
    ];
  });
}
