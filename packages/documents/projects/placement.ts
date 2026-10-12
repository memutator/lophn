// 파일 하나를 정확히 추적에 넣는 규칙(documents/projects#R12). 문서를 파일로 둘 때 그 경로가
// 규칙 밖이면 그 파일 하나의 include만 규칙 끝에 더한다. 마지막 일치가 이기므로 앞의 exclude도
// 이기지만 .git·lophn data와 .gitignore는 이기지 못한다(호출자가 판정으로 다시 확인한다).
import { err, ok, type Result } from "../../base/mod.ts";
import {
  trackingGlobSchema,
  type TrackingRuleSet,
} from "../../protocol/projects/mod.ts";
import { matchTrackingPatterns } from "./rules.ts";

// glob 특수 문자는 문자 클래스 하나로 쓴다. glob schema가 backslash를 막아 `\*`를 쓸 수 없다.
const CLASS_ESCAPED = new Set(["*", "?", "[", "{", "}", "(", ")", "+", "@"]);

function inexact(): Result<never> {
  return err({
    code: "conflict",
    message: "the file cannot be written as an exact tracking rule",
  });
}

// 경로 하나와 정확히 같은 glob. 만들 수 없거나 스스로 확인에 실패하면 conflict다.
export function exactFileGlob(relativePath: string): Result<string> {
  if (relativePath.startsWith("!")) return inexact();
  let glob = "";
  for (const char of relativePath) {
    glob += CLASS_ESCAPED.has(char) ? `[${char}]` : char;
  }
  if (!trackingGlobSchema.safeParse(glob).success) return inexact();
  const rule = [{ effect: "include" as const, glob }];
  // 자기 자신에만 맞아야 한다. 앞뒤에 글자가 붙은 경로에 맞으면 정확한 규칙이 아니다.
  if (
    !matchTrackingPatterns(relativePath, rule).included ||
    matchTrackingPatterns(`${relativePath}x`, rule).included ||
    matchTrackingPatterns(`x${relativePath}`, rule).included ||
    matchTrackingPatterns(`${relativePath}/x`, rule).included
  ) return inexact();
  return ok(glob);
}

// 현재 규칙 끝에 그 파일 하나의 include를 더한 새 규칙. 켜진 상태와 gitignore 선택은 그대로다.
export function includeExactFile(
  tracking: TrackingRuleSet,
  relativePath: string,
): Result<TrackingRuleSet> {
  const glob = exactFileGlob(relativePath);
  if (!glob.ok) return glob;
  return ok({
    ...tracking,
    patterns: [...tracking.patterns, { effect: "include", glob: glob.value }],
  });
}
