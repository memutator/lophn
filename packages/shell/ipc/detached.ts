// project 창, main, detached 창 사이의 detached 탭 경계.
// main·preload·renderer가 함께 부르므로 import는 zod뿐이다. 같은 모양을 renderer/workspace/model.ts의
// DetachedBounds와 main/workspace/schema.ts의 windowBounds도 가진다.
import { z } from "zod";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const projectId = z.string().regex(new RegExp(`^prj_${ULID}$`));
const viewSession = z.string().min(1).refine((value) => !/\p{Cc}/u.test(value));
const tabKey = z.string().min(1).max(4096);
const boundsSchema = z.strictObject({
  x: z.number().int().min(-32768).max(32768),
  y: z.number().int().min(-32768).max(32768),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
});

// project 창 → main. 보낸 창이 project 창(detached 창이 아닌 desktop 창)이어야 한다.
// `open`만 detached 창도 보낼 수 있다(그 창 안에서 열린 popup).
export const DETACHED_OPEN_CHANNEL = "shell:detached-open";
export const DETACHED_FOCUS_CHANNEL = "shell:detached-focus";
export const DETACHED_CLOSE_CHANNEL = "shell:detached-close";
// detached 창 → main. 보낸 창이 detached 창이어야 한다.
export const DETACHED_TAKE_CHANNEL = "shell:detached-take";
export const DETACHED_DOCK_CHANNEL = "shell:detached-dock";
export const DETACHED_CHANGED_CHANNEL = "shell:detached-changed";
export const DETACHED_OPEN_TAB_CHANNEL = "shell:detached-open-tab";
export const DETACHED_REMOVE_CHANNEL = "shell:detached-remove";
// main → renderer push. payload는 DetachedEvent.
export const DETACHED_EVENT_CHANNEL = "shell:detached-event";

export type DetachedBounds = z.infer<typeof boundsSchema>;

/** 탭 값. renderer의 TabItem이 그대로 지난다. main은 key와 kind만 본다. */
export const detachedTabSchema = z.looseObject({
  key: tabKey,
  kind: z.string().min(1).max(64),
});
// z.infer 값은 index signature가 있어 interface인 TabItem을 받지 못한다. 그래서 key와 kind만 적고, 나머지 칸은 쓰는 쪽이 TabItem으로 읽는다.
export type DetachedTab = { key: string; kind: string };

/** 창 사이로 옮기는 살아 있는 상태. value는 kind가 정하는 JSON이고, views는 같이 옮길 앱 view의 view_session이다(main이 받는 창으로 옮긴다). */
export const tabTransferSchema = z.strictObject({
  value: z.json(),
  views: z.array(viewSession).max(8),
});
export type TabTransfer = { value: unknown; views: string[] };

/** IPC 한 번이 64KiB를 넘지 않게 tab.fields에서 직렬화 4096자를 넘는 값(browser favicon의 data URL)을 뺀 사본. 뺀 값은 page가 다시 알린다. 보내는 쪽(project 창, detached 창)이 tab을 main에 보낼 때마다 거친다. */
export function slimDetachedTab<
  T extends { fields?: Readonly<Record<string, unknown>> },
>(tab: T): T {
  if (tab.fields === undefined) return tab;
  const fields = Object.fromEntries(
    Object.entries(tab.fields).filter(([, value]) =>
      (JSON.stringify(value) ?? "").length <= 4096
    ),
  );
  return { ...tab, fields };
}

// 입력(모두 strict. 한 번에 64KiB를 넘으면 ipc-guard가 거절한다). take, remove는 입력이 없다.
export const detachedOpenSchema = z.strictObject({
  project: projectId,
  tab: detachedTabSchema,
  transfer: tabTransferSchema.nullable(),
  bounds: boundsSchema.nullable(),
});
export const detachedFocusSchema = z.strictObject({ key: tabKey });
// null이면 이 project 창의 detached 창 전부
export const detachedCloseSchema = z.strictObject({ key: tabKey.nullable() });
export const detachedDockSchema = z.strictObject({
  tab: detachedTabSchema,
  transfer: tabTransferSchema,
});
// open-tab
export const detachedTabInputSchema = z.strictObject({
  tab: detachedTabSchema,
});
// changed. resume은 창이 조용히 닫힌 뒤(project를 떠남) 같은 key를 다시 열 때 main이 transfer로 쓰는 값이다(kind의 `resume`).
// 없으면 main이 든 값을 그대로 두고 null이면 지운다. 디스크에는 쓰지 않는다.
export const detachedChangedSchema = z.strictObject({
  tab: detachedTabSchema,
  resume: z.json().optional(),
});

// schema의 z.infer는 DetachedTab·TabTransfer를 받지 못해 입력 type은 따로 쓴다.
export interface DetachedOpenInput {
  project: string;
  tab: DetachedTab;
  transfer: TabTransfer | null;
  bounds: DetachedBounds | null;
}
export interface DetachedDockInput {
  tab: DetachedTab;
  transfer: TabTransfer;
}

export interface DetachedTaken {
  project: string;
  tab: DetachedTab;
  transfer: TabTransfer | null;
}

export type DetachedEvent =
  // → project 창
  /** detached 창이 돌아왔다. transfer가 null이면 저장된 값으로만 돌아온다(창이 갑자기 닫힘). */
  | {
    kind: "docked";
    key: string;
    tab: DetachedTab;
    transfer: TabTransfer | null;
  }
  /** detached 창에서 탭 값이 바뀌었다(patchTab). */
  | { kind: "changed"; key: string; tab: DetachedTab }
  /** detached 창이 project 창에 탭을 열라고 한다. */
  | { kind: "open-tab"; tab: DetachedTab }
  /** detached 창이 탭을 닫았다(removeTab). */
  | { kind: "closed"; key: string }
  /** detached 창이 또 하나의 detached 창을 열었다(그 안의 popup). 이 탭은 아직 layout에 없다. */
  | { kind: "opened"; tab: DetachedTab; bounds: DetachedBounds }
  /** detached 창을 옮기거나 크기를 바꿨다(layout을 다시 저장하라). */
  | { kind: "moved" }
  // → detached 창
  /** 창 닫기(×)가 눌렸다. [Dock]과 같게 하라. */
  | { kind: "dock-request" };

// push를 거르는 schema. 위 type과 같은 모양이다.
export const detachedEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("docked"),
    key: tabKey,
    tab: detachedTabSchema,
    transfer: tabTransferSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("changed"),
    key: tabKey,
    tab: detachedTabSchema,
  }),
  z.strictObject({ kind: z.literal("open-tab"), tab: detachedTabSchema }),
  z.strictObject({ kind: z.literal("closed"), key: tabKey }),
  z.strictObject({
    kind: z.literal("opened"),
    tab: detachedTabSchema,
    bounds: boundsSchema,
  }),
  z.strictObject({ kind: z.literal("moved") }),
  z.strictObject({ kind: z.literal("dock-request") }),
]);

export type DetachedReply<T> =
  | { ok: true; value: T }
  | {
    ok: false;
    error: {
      code:
        | "invalid_input"
        | "forbidden"
        | "not_found"
        | "conflict"
        | "unavailable";
      message: string;
    };
  };

/** window.lophnDetached. 거절은 code만 실은 Error다. 두 방향 모두 이 하나다. 보낸 창이 맞는 쪽이 아니면 main이 forbidden으로 거절한다. */
export interface LophnDetachedApi {
  // project 창
  /** 만든 창의 bounds를 돌려준다. */
  open(input: DetachedOpenInput): Promise<{
    bounds: DetachedBounds;
  }>;
  focus(input: { key: string }): Promise<void>;
  close(input: { key: string | null }): Promise<void>;
  // detached 창
  take(): Promise<DetachedTaken>;
  dock(input: DetachedDockInput): Promise<void>;
  changed(input: { tab: DetachedTab; resume?: unknown }): Promise<void>;
  openTab(input: { tab: DetachedTab }): Promise<void>;
  remove(): Promise<void>;
  // 양쪽
  subscribe(listener: (event: DetachedEvent) => void): () => void;
}
