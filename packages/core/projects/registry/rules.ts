import ignore from "ignore";
import picomatch from "picomatch";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { TrackingPattern } from "../../../protocol/projects/mod.ts";
import { type CanonicalRoot, rootRelation } from "./model.ts";

// 등록 root 안의 lophn data 폴더. install의 ~/.lophn과 같은 이름이다.
export const LOPHN_DATA_DIR = ".lophn";
// 사람 파일 쓰기가 같은 폴더에 잠깐 만드는 임시 파일의 이름 접두. 추적 대상이 아니다.
export const WRITE_TEMP_PREFIX = ".lophn-write-";

export type TrackingDecision = {
  included: boolean;
  reason: string;
};

export type GitignoreRule = {
  // 등록 root 기준 `/` 상대 디렉터리. root 자신은 "".
  directory: string;
  // .gitignore 본문. 줄 순서는 파일 그대로다.
  text: string;
};

// 마지막 일치가 이긴다. 한 번도 안 맞으면 제외다.
export function matchTrackingPatterns(
  relativePath: string,
  patterns: readonly TrackingPattern[],
): TrackingDecision {
  let matched: TrackingDecision | null = null;
  for (const pattern of patterns) {
    // matcher 함수는 glob과 입력이 같으면 regex 전에 맞춘다. regex만 쓴다.
    // fastpaths의 **/*.md는 확장자 대소문자를 가리지 않아 OS locale과 무관하게 끈다.
    const regex = picomatch.makeRe(pattern.glob, {
      dot: true,
      fastpaths: false,
      windows: false,
    });
    const matches = regex.test(relativePath);
    if (!matches) continue;
    matched = {
      included: pattern.effect === "include",
      reason: pattern.effect === "include"
        ? `include ${pattern.glob}`
        : `exclude ${pattern.glob}`,
    };
  }
  return matched ?? { included: false, reason: "unmatched" };
}

// .git 내부·lophn data 폴더·등록 root 밖은 include로도 추적하지 않는다.
export function hardExclusion(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts.includes(".git")) return "inside .git";
  if (parts.includes(LOPHN_DATA_DIR)) return "inside lophn data";
  if (parts.some((part) => part.startsWith(WRITE_TEMP_PREFIX))) {
    return "lophn temporary file";
  }
  return null;
}

// symlink가 가리키는 실제 경로가 등록 root 안이 아니면 추적하지 않는다.
// 순회에서 만난 디렉터리와 마지막으로 연 파일 둘 다에 쓴다.
export function symlinkEscapesRoot(
  root: CanonicalRoot,
  realPath: CanonicalRoot,
): Result<boolean> {
  const relation = rootRelation(root, realPath);
  if (!relation.ok) return relation;
  return ok(relation.value !== "equal" && relation.value !== "ancestor");
}

// gitignore는 가장 깊은 파일부터 적용하고, 한 파일 안에서는 마지막 일치다.
// 부모 디렉터리가 제외되면 그 안의 재포함은 따라가지 않는다.
export function gitignoreExcludes(
  relativePath: string,
  rules: readonly GitignoreRule[],
): boolean {
  const ordered = [...rules].sort((left, right) =>
    right.directory.length - left.directory.length
  );
  for (const rule of ordered) {
    const prefix = rule.directory === "" ? "" : `${rule.directory}/`;
    if (rule.directory !== "" && !relativePath.startsWith(prefix)) continue;
    const local = rule.directory === ""
      ? relativePath
      : relativePath.slice(prefix.length);
    const manager = ignore({ ignorecase: false });
    const lines = rule.text.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    manager.add(lines);
    if (manager.ignores(local)) return true;
    if (manager.test(local).unignored) return false;
  }
  return false;
}

export function decideTracking(input: {
  relativePath: string;
  patterns: readonly TrackingPattern[];
  useGitignore: boolean;
  gitignore: readonly GitignoreRule[];
  escapesRoot: boolean;
  enabled: boolean;
}): Result<TrackingDecision> {
  if (
    input.relativePath === "" ||
    input.relativePath.split("/").some((part) =>
      part === "" || part === "." || part === ".."
    )
  ) {
    return err({ code: "invalid_input", message: "invalid relative path" });
  }
  const blocked = hardExclusion(input.relativePath);
  if (blocked !== null) return ok({ included: false, reason: blocked });
  if (!input.enabled) {
    return ok({ included: false, reason: "tracking disabled" });
  }
  if (input.escapesRoot) {
    return ok({ included: false, reason: "symlink outside root" });
  }
  if (
    input.useGitignore && gitignoreExcludes(input.relativePath, input.gitignore)
  ) {
    return ok({ included: false, reason: "gitignore" });
  }
  return ok(matchTrackingPatterns(input.relativePath, input.patterns));
}
