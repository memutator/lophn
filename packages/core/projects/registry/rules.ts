import ignore from "ignore";
import { ok, type Result } from "../../../base/mod.ts";
import { type CanonicalRoot, rootRelation } from "./model.ts";

export type GitignoreRule = {
  // 등록 root 기준 `/` 상대 디렉터리. root 자신은 "".
  directory: string;
  // .gitignore 본문. 줄 순서는 파일 그대로다.
  text: string;
};

// symlink가 가리키는 실제 경로가 등록 root 안이 아니면 따라가지 않는다.
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
