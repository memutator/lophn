// git 쓰기 실패의 분류(spec 5.5 구조화 오류 코드), 충돌 마커 찾기, AI 커밋 메시지 재료의 파일별 공평 분배. 순수 함수다.
import { err, type Result } from "../../../base/mod.ts";
import type { SourceControlFailure } from "../../../protocol/projects/source-control.ts";
import { type GitRunResult, isGitAuthError } from "../worktrees/mod.ts";

const STDERR_MAX = 16 * 1024;

type Code = "unauthorized" | "conflict" | "unavailable" | "not_found";

/** 화면이 접어 보일 출력. hook은 stdout에 쓰는 일이 많아 둘을 이어 붙이고 끝(가장 최근)을 남긴다. */
export function outputOf(res: GitRunResult): string {
  const text = [res.stderr.trim(), res.stdout.trim()]
    .filter((part) => part !== "")
    .join("\n");
  return text.length > STDERR_MAX ? text.slice(text.length - STDERR_MAX) : text;
}

const PATTERNS: readonly (readonly [RegExp, SourceControlFailure, Code])[] = [
  [
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    "host_key_unverified",
    "unauthorized",
  ],
  [
    /gpg failed to sign|failed to sign the data|pinentry|error: gpg|signing failed|ssh-keygen.*-Y sign/i,
    "gpg_failed",
    "conflict",
  ],
  [
    /Not possible to fast-forward|diverging branches|have diverged/i,
    "diverged",
    "conflict",
  ],
  [
    /no tracking information|has no upstream branch|no upstream configured/i,
    "no_upstream",
    "conflict",
  ],
  [
    /non-fast-forward|\(fetch first\)|tip of your current branch is behind/i,
    "non_fast_forward",
    "conflict",
  ],
  [
    /\[remote rejected\]|pre-receive hook declined|\[rejected\]/i,
    "push_rejected",
    "conflict",
  ],
  [
    /does not appear to be a git repository|No such remote|No configured push destination/i,
    "no_remote",
    "conflict",
  ],
  [
    /Could not resolve host|unable to access|Connection (refused|timed out|reset)|Could not read from remote repository|Network is unreachable|Operation timed out/i,
    "remote_unreachable",
    "unavailable",
  ],
  [/CONFLICT \(|Automatic merge failed/i, "merge_conflict", "conflict"],
  [
    /would be overwritten|Please commit your changes or stash|local changes/i,
    "dirty_worktree",
    "conflict",
  ],
];

/**
 * 실패한 git 실행을 경계 오류로 바꾼다. `hookFailure`는 커밋처럼 hook이 돌았을 수 있는 실행에서
 * 다른 분류에 들지 않는 실패를 `hook_failed`로 읽는다.
 */
export function gitFailure(
  res: GitRunResult,
  fallback: string,
  options: { readonly hookFailure?: boolean; readonly command?: string } = {},
): Result<never> {
  const output = outputOf(res);
  const first = output.split(/\r?\n/).find((line) => line.trim() !== "");
  const base = (reason: SourceControlFailure, code: Code, message?: string) =>
    err({
      code,
      message: message ?? first ?? fallback,
      details: {
        reason,
        stderr: output,
        ...(options.command === undefined ? {} : { command: options.command }),
      },
    });
  if (res.timedOut) return base("timeout", "unavailable");
  // 묻는 창을 띄우지 않는다. 사람이 터미널에서 칠 명령 한 줄을 준다.
  if (isGitAuthError(res.stderr)) {
    return base(
      "auth_failed",
      "unauthorized",
      options.command === undefined
        ? undefined
        : `git authentication failed; run in terminal: ${options.command}`,
    );
  }
  for (const [pattern, reason, code] of PATTERNS) {
    if (pattern.test(output)) return base(reason, code);
  }
  return options.hookFailure === true
    ? base("hook_failed", "conflict")
    : base("git_error", "unavailable");
}

export function refused(
  reason: SourceControlFailure,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): Result<never> {
  return err({ code: "conflict", message, details: { reason, ...extra } });
}

// 단독 `=======` 줄(Markdown setext 제목 밑줄 등) 오탐을 피하고 git 충돌 시작/끝 마커만 잡는다.
const START = /^<{7}(?: |$)/;
const END = /^>{7}(?: |$)/;

export interface MarkerHit {
  readonly path: string;
  readonly line: number;
}

/** staged diff의 더한 줄에서 시작과 끝 마커가 함께 있는 파일의 마커 줄(새 파일 기준 줄 번호). */
export function conflictMarkersInDiff(diff: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  let path: string | null = null;
  let line = 0;
  let starts: MarkerHit[] = [];
  let sawEnd = false;
  const flush = () => {
    if (path !== null && starts.length > 0 && sawEnd) hits.push(...starts);
    starts = [];
    sawEnd = false;
  };
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      flush();
      path = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      path = target === "/dev/null" ? null : target.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (path === null) continue;
    if (raw.startsWith("+")) {
      const body = raw.slice(1);
      if (START.test(body)) starts.push({ path, line });
      else if (END.test(body)) sawEnd = true;
      line += 1;
    } else if (raw.startsWith(" ")) {
      line += 1;
    }
  }
  flush();
  return hits.slice(0, 20);
}

/** 디스크 파일 글에 시작과 끝 마커가 함께 있는가. */
export function hasConflictMarkers(text: string): boolean {
  let start = false;
  for (const line of text.split(/\r?\n/)) {
    if (START.test(line)) start = true;
    else if (start && END.test(line)) return true;
  }
  return false;
}

/**
 * staged diff를 파일별로 나눠 총 `budget` 글자 안에 담는다. 작은 파일은 다 싣고 남은 몫을 큰 파일들이 똑같이 나눈다.
 * 잘린 파일은 끝에 표시를 단다.
 */
export function fairDiff(diff: string, budget: number): string {
  const parts = diff
    .split(/(?=^diff --git )/m)
    .filter((part) => part.trim() !== "");
  if (parts.length === 0) return "";
  const order = parts
    .map((text, index) => ({ text, index }))
    .sort((a, b) => a.text.length - b.text.length);
  const kept = new Map<number, string>();
  let left = budget;
  order.forEach((part, at) => {
    const share = Math.floor(left / (order.length - at));
    const text =
      part.text.length <= share
        ? part.text
        : `${part.text.slice(0, Math.max(share - 40, 0))}\n[… diff truncated …]\n`;
    kept.set(part.index, text);
    left -= text.length;
  });
  return parts.map((_, index) => kept.get(index) ?? "").join("");
}
