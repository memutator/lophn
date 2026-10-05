// 추적 켜기의 순수 규칙. 화면 문구는 고르지 않고 어떤 상태·이유인지만 정한다.
import type {
  PreviewEntry,
  RuleSet,
  TrackedRoot,
  TrackingProject,
  TrackingRule,
} from "./source.ts";

/**
 * 추적 켜기 창이 처음 보이는 규칙. 한 번도 규칙을 고르지 않은 프로젝트는 기본 제안(Markdown과
 * .gitignore)이고, 전에 고른 규칙이 있으면 그것을 켠 채로 다시 보인다(documents/projects#R3).
 */
export function startingRules(project: TrackingProject): RuleSet {
  const base = project.tracking.patterns.length === 0
    ? project.proposal
    : project.tracking;
  return {
    enabled: true,
    patterns: base.patterns.map((rule) => ({ ...rule })),
    useGitignore: base.useGitignore,
  };
}

/** documents의 glob 규칙과 같다: 폴더 기준 상대, 위로 나가지 않음. */
export function usableGlob(glob: string): boolean {
  return glob.length > 0 && !glob.startsWith("/") &&
    !/^[A-Za-z]:/.test(glob) && !/[\\\p{Cc}]/u.test(glob) &&
    !glob.split("/").includes("..");
}

export function usableRules(rules: RuleSet): boolean {
  return rules.patterns.every((rule) => usableGlob(rule.glob));
}

export function sameRules(left: RuleSet, right: RuleSet): boolean {
  return left.enabled === right.enabled &&
    left.useGitignore === right.useGitignore &&
    left.patterns.length === right.patterns.length &&
    left.patterns.every((rule, index) =>
      rule.effect === right.patterns[index]!.effect &&
      rule.glob === right.patterns[index]!.glob
    );
}

export function withRule(rules: RuleSet, rule: TrackingRule): RuleSet {
  return { ...rules, patterns: [...rules.patterns, rule] };
}

export function changeRule(
  rules: RuleSet,
  index: number,
  rule: TrackingRule,
): RuleSet {
  return {
    ...rules,
    patterns: rules.patterns.map((item, at) => at === index ? rule : item),
  };
}

export function withoutRule(rules: RuleSet, index: number): RuleSet {
  return {
    ...rules,
    patterns: rules.patterns.filter((_, at) => at !== index),
  };
}

/** 미리보기 이유를 사람 말 종류로 옮긴다. 모르는 이유는 포함·제외만 말한다. */
export type ReasonKind =
  | { kind: "included"; glob: string }
  | { kind: "excluded"; glob: string }
  | { kind: "unmatched" }
  | { kind: "gitignore" }
  | { kind: "inside-git" }
  | { kind: "inside-lophn" }
  | { kind: "outside-link" }
  | { kind: "tracking-off" }
  | { kind: "other" };

export function reasonOf(reason: string): ReasonKind {
  if (reason.startsWith("include ")) {
    return { kind: "included", glob: reason.slice("include ".length) };
  }
  if (reason.startsWith("exclude ")) {
    return { kind: "excluded", glob: reason.slice("exclude ".length) };
  }
  switch (reason) {
    case "unmatched":
      return { kind: "unmatched" };
    case "gitignore":
      return { kind: "gitignore" };
    case "inside .git":
      return { kind: "inside-git" };
    case "inside lophn data":
      return { kind: "inside-lophn" };
    case "symlink outside root":
      return { kind: "outside-link" };
    case "tracking disabled":
      return { kind: "tracking-off" };
    default:
      return { kind: "other" };
  }
}

export interface PreviewGroups {
  readonly tracked: readonly PreviewEntry[];
  readonly leftOut: readonly PreviewEntry[];
}

export function groupPreview(entries: readonly PreviewEntry[]): PreviewGroups {
  return {
    tracked: entries.filter((entry) => entry.included),
    leftOut: entries.filter((entry) => !entry.included),
  };
}

/** 미리보기 목록에서 묶음마다 처음 보이는 행 수. 나머지는 수로만 말한다. */
export const PREVIEW_ROWS = 50;

function trimmed(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function within(parent: string, child: string): boolean {
  const root = trimmed(parent);
  const path = trimmed(child);
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}

/**
 * 이 프로젝트 폴더와 겹치는 다른 프로젝트의 켜진 추적 폴더. 같은 폴더·조상·자손을 겹침으로
 * 본다(documents/projects#R7). 실제 경로 비교는 core가 적용 때 다시 한다.
 */
export function overlapOf(
  folders: readonly { readonly path: string }[],
  roots: readonly TrackedRoot[],
): { other: string; path: string } | null {
  for (const folder of folders) {
    for (const root of roots) {
      if (within(folder.path, root.path) || within(root.path, folder.path)) {
        return { other: root.title, path: folder.path };
      }
    }
  }
  return null;
}

/** 적용 거절의 종류. 각각 사람이 할 다음 행동이 하나다(shell/wording#R10). */
export type ApplyFailure =
  | { kind: "changed" }
  | { kind: "overlap"; other: string; path: string }
  | { kind: "failed" };

/**
 * conflict는 미리보기 뒤 프로젝트가 바뀌었거나 다른 켜진 추적과 겹친 것이다. 오류 글은 읽지
 * 않고 현재 프로젝트 판과 켜진 폴더를 다시 읽어 가른다.
 */
export function applyFailure(
  code: string,
  preview: { baseRevision: string },
  current: TrackingProject | null,
  roots: readonly TrackedRoot[] | null,
): ApplyFailure {
  if (code !== "conflict") return { kind: "failed" };
  if (current !== null && current.revision !== preview.baseRevision) {
    return { kind: "changed" };
  }
  const overlap = current && roots ? overlapOf(current.folders, roots) : null;
  return overlap ? { kind: "overlap", ...overlap } : { kind: "changed" };
}

/** 미리보기를 못 만든 이유. 접근 문제는 그 폴더를 이름으로 말한다. */
export type PreviewFailure =
  | { kind: "unreadable"; folder: string | null }
  | { kind: "changed" };

export function previewFailure(
  code: string,
  folders: readonly { readonly path: string }[],
): PreviewFailure {
  if (code === "conflict") return { kind: "changed" };
  return {
    kind: "unreadable",
    folder: folders.length === 1 ? folders[0]!.path : null,
  };
}
