// WorkspaceLayout(domain-model/shell/workspace)의 검증과 기본값, 읽던 위치
// 보존의 순수 동작만 둔다. schema 원본은 schema.ts가 정한다.
import {
  type InformationPanel,
  informationPanelSchema,
  LAYOUT_SCHEMA_VERSION,
  type LayoutFile,
  layoutFileSchema,
  type LayoutTab,
  type WorkspaceLayout,
  workspaceLayoutSchema,
} from "./schema.ts";
import { tabKindOf } from "./kinds/registry.ts";

export type {
  InformationPanel,
  LayoutFile,
  LayoutPane,
  LayoutTab,
  WindowBounds,
  WorkspaceLayout,
} from "./schema.ts";

export const SCHEMA_VERSION = LAYOUT_SCHEMA_VERSION;

export type LayoutResult =
  | { ok: true; layout: WorkspaceLayout }
  | { ok: false; reason: "unsupported_schema" | "corrupt" };

/**
 * 파일에서 읽은 값을 검증한다. 미지원 schema와 손상은 안전한 오류로 빈 layout을
 * 가리킨다. 원본 파일은 바꾸지 않는다.
 */
export function parseLayoutFile(value: unknown): LayoutResult {
  if (
    typeof value === "object" && value !== null && "schema_version" in value &&
    typeof (value as { schema_version: unknown }).schema_version === "number"
  ) {
    const version = (value as { schema_version: number }).schema_version;
    if (version !== SCHEMA_VERSION) {
      return { ok: false, reason: "unsupported_schema" };
    }
  }
  const parsed = layoutFileSchema.safeParse(skipUnregisteredTabs(value));
  if (!parsed.success) return { ok: false, reason: "corrupt" };
  return { ok: true, layout: parsed.data.layout };
}

/**
 * registry에 없는 kind(지운 옛 kind 포함)의 탭은 자리표시 없이 건너뛰고 나머지 탭의 순서·선택을
 * 지킨다(domain-model TabKind registry). 선택 탭이 건너뛴 탭이면 첫 남은 탭으로 옮긴다. 그 밖의
 * 모양 오류는 손대지 않고 schema 검증이 손상으로 판단한다.
 */
function skipUnregisteredTabs(value: unknown): unknown {
  const layout = (value as { layout?: unknown } | null)?.layout as
    | { panes?: unknown }
    | null
    | undefined;
  if (typeof layout !== "object" || layout === null) return value;
  if (!Array.isArray(layout.panes)) return value;
  let changed = false;
  const panes = layout.panes.map((pane: unknown) => {
    const tabs = (pane as { tabs?: unknown } | null)?.tabs;
    if (!Array.isArray(tabs)) return pane;
    const kept = tabs.filter((tab: unknown) => {
      const kind = (tab as { kind?: unknown } | null)?.kind;
      return typeof kind !== "string" || tabKindOf(kind) !== undefined;
    });
    if (kept.length === tabs.length) return pane;
    changed = true;
    const selected = (pane as { selected_tab?: unknown }).selected_tab;
    const stillThere = kept.some((tab: unknown) =>
      (tab as { key?: unknown } | null)?.key === selected
    );
    const first = (kept[0] as { key?: unknown } | undefined)?.key ?? null;
    return {
      ...(pane as object),
      tabs: kept,
      selected_tab: selected === null || stillThere ? selected : first,
    };
  });
  if (!changed) return value;
  return { ...(value as object), layout: { ...layout, panes } };
}

/** file schema의 layout을 감싼다. */
export function toLayoutFile(layout: WorkspaceLayout): LayoutFile {
  return { schema_version: SCHEMA_VERSION, layout };
}

export function emptyLayout(project: string): WorkspaceLayout {
  return {
    schema_version: SCHEMA_VERSION,
    project,
    window_bounds: { x: 0, y: 0, width: 960, height: 600 },
    last_space: "launcher",
    panes: [{ tabs: [], selected_tab: null }],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  };
}

/** 저장 전 검증. 실패 원문 대신 안전한 이유만 내놓는다. */
export function validateLayout(value: unknown): LayoutResult {
  const parsed = workspaceLayoutSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "corrupt" };
  return { ok: true, layout: parsed.data };
}

export function validateInformationPanel(
  value: unknown,
): InformationPanel | undefined {
  const parsed = informationPanelSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** 두 칸 각각의 최소 폭은 480px다. */
export const MIN_PANE_WIDTH = 480;

/**
 * 창 폭으로 두 칸을 유지할 수 있는지. 부족하면 저장된 panes·split_ratio·탭
 * 소속을 바꾸지 않고 한 칸 보기로 표시한다(domain-model 정책).
 */
export function fitsTwoPanes(windowWidth: number): boolean {
  return windowWidth >= MIN_PANE_WIDTH * 2 + 1;
}

/** 읽던 위치는 그것을 가진 kind의 선언에서만 온다. 다른 kind는 위치를 버린다. */
export function readPositionOf(tab: LayoutTab): {
  section: string;
  scroll_offset: number;
} | undefined {
  return tabKindOf(tab.kind)?.readPosition?.(tab);
}
