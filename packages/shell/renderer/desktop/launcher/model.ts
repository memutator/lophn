// 런처 카드와 등록 창의 순수 규칙. 화면 문구는 고르지 않고 어느 상태인지만 정한다.
import type { FolderDraft, ProjectCard } from "./source.ts";

/** documents values의 slug 상한. */
export const SHORT_NAME_MAX = 63;
const FALLBACK_NAME = "project";

/** 카드의 상태 한 줄. 사람이 지금 알아야 할 것 하나만 고른다(documents/projects#R8). */
export type CardStatus = "tracking" | "not-tracking" | "no-folder";

export function cardStatus(card: ProjectCard): CardStatus {
  if (card.tracking.enabled) return "tracking";
  return card.folders.length === 0 ? "no-folder" : "not-tracking";
}

function slugOf(title: string): string {
  const words = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // slug는 글자로 시작한다. 숫자로 시작하거나 영문이 없는 이름은 고정 앞말을 붙인다.
  const start = /^[a-z]/.test(words)
    ? words
    : words === ""
    ? FALLBACK_NAME
    : `${FALLBACK_NAME}-${words}`;
  return start.slice(0, SHORT_NAME_MAX).replace(/-+$/, "");
}

/**
 * 사람이 지은 이름에서 안쪽 짧은 이름을 만든다. 사람에게 묻지 않고 펼친 상세에만 보이므로
 * 이미 쓰는 이름과 겹치면 뒤에 번호를 붙인다.
 */
export function shortNameOf(title: string, taken: readonly string[]): string {
  const base = slugOf(title);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let index = 2;; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${
      base.slice(0, SHORT_NAME_MAX - suffix.length).replace(/-+$/, "")
    }${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 고른 폴더를 더한다. 이미 있는 폴더는 다시 넣지 않는다. */
export function addFolder(
  folders: readonly FolderDraft[],
  path: string,
): readonly FolderDraft[] {
  return folders.some((folder) => folder.path === path)
    ? folders
    : [...folders, { path, description: "" }];
}

/** 등록 실패의 종류. 이름 겹침만 사람이 고칠 수 있는 입력이다. */
export type RegisterFailure = "name-taken" | "failed";

export function registerFailure(code: string): RegisterFailure {
  return code === "conflict" ? "name-taken" : "failed";
}

/** 이름은 공백만으로 둘 수 없다. */
export function usableTitle(title: string): boolean {
  return title.trim().length > 0;
}
