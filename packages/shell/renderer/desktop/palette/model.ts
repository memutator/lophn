// 명령 팔레트의 순수 규칙. 공간마다 묶음 순서가 정해져 있고 행은
// 그 공간의 지금 탐색 대상만 가리킨다. overlay에는 행 id·이름만 가고 대상은 여기 남는다.
import type { OverlayModel, PaletteIcon } from "../../../ipc/overlay.ts";

export type PaletteGroup =
  | "tabs"
  | "files"
  | "bookmarks"
  | "actions"
  | "projects"
  | "apps";

/** 프로젝트 작업대: 열린 탭·파일·bookmark·행동. */
export const WORKSPACE_GROUPS: readonly PaletteGroup[] = [
  "tabs",
  "files",
  "bookmarks",
  "actions",
];

/** 작업대 밖(런처·Settings 창, 전역 팔레트): 프로젝트·앱·파일·행동. */
export const DESKTOP_GROUPS: readonly PaletteGroup[] = [
  "projects",
  "apps",
  "files",
  "actions",
];

/** project 키워드 검색에서 일치한 줄 하나. 고르면 그 project 창에서 그 줄을 연다. */
export interface FileFound {
  readonly project: string;
  /** 등록 폴더 기준 상대 경로. */
  readonly path: string;
  /** 디스크의 절대 경로. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface PaletteEntry<T> {
  readonly group: PaletteGroup;
  /** 같은 대상을 두 번 보이지 않게 하는 열쇠. */
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly icon: PaletteIcon;
  /** icon 대신 그릴 작은 이미지(bookmark favicon, data URL). */
  readonly image?: string;
  readonly target: T;
  /** 검색이 이미 고른 행. 이름으로 다시 거르지 않는다. */
  readonly found?: boolean;
}

/** 묶음 하나에 보이는 행 수. 다섯 묶음이 overlay 행 한도 64 안에 든다. */
const GROUP_LIMIT = 12;

/** 검색어를 멈춘 뒤 파일 검색을 부르기까지. */
export const SEARCH_DEBOUNCE_MS = 150;

function matches(entry: PaletteEntry<unknown>, words: string): boolean {
  if (words === "" || entry.found) return true;
  return (
    entry.label.toLocaleLowerCase().includes(words) ||
    (entry.detail ?? "").toLocaleLowerCase().includes(words)
  );
}

/**
 * 공간의 묶음 순서로 행을 놓는다. 검색어는 이름·보조 글로 거르고, 공간에 없는 묶음과
 * 겹친 대상은 뺀다. 묶음마다 GROUP_LIMIT까지만 둔다.
 */
export function arrange<T>(
  order: readonly PaletteGroup[],
  entries: readonly PaletteEntry<T>[],
  query: string,
): PaletteEntry<T>[] {
  const words = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const result: PaletteEntry<T>[] = [];
  for (const group of order) {
    let count = 0;
    for (const entry of entries) {
      if (entry.group !== group || count >= GROUP_LIMIT) continue;
      if (seen.has(entry.key) || !matches(entry, words)) continue;
      seen.add(entry.key);
      result.push(entry);
      count += 1;
    }
  }
  return result;
}

// overlay schema 한도(이름·보조 글 256자, 키 이름 32자) 안으로 자른다.
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * overlay에 보낼 모양. 행 id는 판마다 새로 지어 옛 판의 id가 새 행을 고르지 않게 한다.
 * 대상은 돌려준 표에만 있고 main·overlay로 가지 않는다.
 */
export function paletteModel<T>(
  title: string,
  rows: readonly PaletteEntry<T>[],
  serial: number,
  groupLabel: (group: PaletteGroup) => string,
): { model: OverlayModel; targets: Map<string, T> } {
  const targets = new Map<string, T>();
  const choices = rows
    .filter((row) => row.label.trim() !== "")
    .map((row, index) => {
      const id = `${row.group}-${serial}-${index}`;
      targets.set(id, row.target);
      return {
        id,
        label: clip(row.label, 256),
        group: clip(groupLabel(row.group), 64),
        icon: row.icon,
        ...(row.image ? { image: row.image } : {}),
        ...(row.detail ? { detail: clip(row.detail, 256) } : {}),
        ...(row.hint ? { hint: clip(row.hint, 32) } : {}),
      };
    });
  return {
    model: { label: clip(title, 256), search: true, choices },
    targets,
  };
}
