// series kind의 pattern에서 멤버·순서·다음 이름을 계산하는 순수 함수(documents/series).
// 파일을 만들거나 예약하거나 저장하지 않는다. 같은 pattern과 같은 경로 목록은 같은 결과를 낸다.
import { err, ok, type Result } from "../../../base/mod.ts";

export type SeriesPart = "n" | "major" | "minor" | "patch";

export type SeriesPattern = {
  text: string;
  // 파일 이름 칸 앞의 literal 폴더 칸들.
  folders: readonly string[];
  // 파일 이름 칸에서 번호 자리 앞뒤의 글자. `*`가 들어 있을 수 있다.
  before: string;
  after: string;
  part: SeriesPart;
  // 부호 있는 정수. 생략은 +1.
  step: number;
  // 1~4. 생략이면 null이고 마지막 멤버 key에서 바꾸는 성분의 글자 수를 따른다.
  width: number | null;
};

export type SeriesMember = {
  path: string;
  // 번호 자리가 잡은 글자. 앞자리 0을 유지한다.
  key: string;
  // key를 "."로 나눈 10진 정수. 순서 비교에 쓴다.
  parts: number[];
};

export type SeriesNext = {
  // 계산 불가면 빈 문자열.
  key: string;
  // 계산 불가면 null. `*`는 그대로 남는다.
  path: string | null;
  // 마지막 멤버의 path. 멤버가 없으면 null.
  from: string | null;
  // path가 있고 `*`가 없으면 true.
  complete: boolean;
  // 계산한 key를 가진 멤버가 이미 있다.
  taken: boolean;
};

const PLACE = /\{(n|major|minor|patch)(?:([+-])(\d+))?(?::(\d+))?\}/;
const MAX = Number.MAX_SAFE_INTEGER;

function invalid(text: string, why: string): Result<SeriesPattern> {
  return err({
    code: "invalid_input",
    message: `invalid series pattern ${JSON.stringify(text)}: ${why}`,
  });
}

// 문법 위반은 invalid_input이다.
export function parsePattern(text: string): Result<SeriesPattern> {
  if (text.trim() !== text) return invalid(text, "surrounding whitespace");
  const segments = text.split("/");
  const name = segments[segments.length - 1]!;
  const folders = segments.slice(0, -1);
  for (const folder of folders) {
    if (folder === "" || folder === "..") {
      return invalid(text, "empty or '..' folder");
    }
    if (/[*{}]/.test(folder)) return invalid(text, "folder is not literal");
  }
  const match = PLACE.exec(name);
  if (name === "" || name === ".." || !match) {
    return invalid(text, "exactly one number place is required");
  }
  const before = name.slice(0, match.index);
  const after = name.slice(match.index + match[0].length);
  if (/[{}]/.test(before) || /[{}]/.test(after)) {
    return invalid(text, "exactly one number place is required");
  }

  let step = 1;
  if (match[2] !== undefined) {
    const value = Number(match[3]);
    if (!Number.isSafeInteger(value)) return invalid(text, "step out of range");
    step = match[2] === "-" && value !== 0 ? -value : value;
  }
  let width: number | null = null;
  if (match[4] !== undefined) {
    width = Number(match[4]);
    if (!(width >= 1 && width <= 4)) return invalid(text, "width is 1 to 4");
  }

  const prev = before.slice(-1);
  if (prev === "*" || /^\d$/.test(prev)) {
    return invalid(text, "bad character before the number place");
  }
  const next = after.slice(0, 1);
  if (next === "*" || /^\d$/.test(next)) {
    return invalid(text, "bad character after the number place");
  }
  if (next === "." && /^\d$/.test(after.slice(1, 2))) {
    return invalid(text, "digit after '.' following the number place");
  }

  return ok({
    text,
    folders,
    before,
    after,
    part: match[1] as SeriesPart,
    step,
    width,
  });
}

function escapeLiteral(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function literalToSource(text: string): string {
  return text.split("*").map(escapeLiteral).join("[^/]*");
}

function memberRegExp(pattern: SeriesPattern): RegExp {
  const folders = pattern.folders.map((folder) => escapeLiteral(folder) + "/")
    .join("");
  const place = pattern.part === "n" ? "\\d+" : "\\d+(?:\\.\\d+)*";
  return new RegExp(
    `^${folders}${literalToSource(pattern.before)}(${place})${
      literalToSource(pattern.after)
    }$`,
    "u",
  );
}

// locale 독립 codepoint 순 비교.
function compareText(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function compareMembers(a: SeriesMember, b: SeriesMember): number {
  const length = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < length; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return compareText(a.key, b.key) || compareText(a.path, b.path);
}

// pattern 전체에 맞는 파일만, key의 숫자를 수로 비교한 자연 순서로 돌려준다.
export function listMembers(
  pattern: SeriesPattern,
  paths: readonly string[],
): SeriesMember[] {
  const regexp = memberRegExp(pattern);
  const members: SeriesMember[] = [];
  for (const path of paths) {
    const key = regexp.exec(path)?.[1];
    if (key === undefined) continue;
    const parts = key.split(".").map(Number);
    if (!parts.every((part) => Number.isSafeInteger(part))) continue;
    members.push({ path, key, parts });
  }
  return members.sort(compareMembers);
}

// 바꾸는 성분의 자리.
function changedIndex(part: SeriesPart, count: number): number {
  switch (part) {
    case "n":
    case "major":
      return 0;
    case "minor":
      return count >= 2 ? 1 : 0;
    case "patch":
      return count >= 3 ? 2 : count - 1;
  }
}

export function nextName(
  pattern: SeriesPattern,
  paths: readonly string[],
): SeriesNext {
  const members = listMembers(pattern, paths);
  const last = members[members.length - 1];
  if (last === undefined) {
    return { key: "", path: null, from: null, complete: false, taken: false };
  }
  const empty: SeriesNext = {
    key: "",
    path: null,
    from: last.path,
    complete: false,
    taken: false,
  };

  const texts = last.key.split(".");
  const index = changedIndex(pattern.part, texts.length);
  const value = Math.max(0, last.parts[index]! + pattern.step);
  if (value > MAX) return empty;
  const width = pattern.width ?? texts[index]!.length;
  const key = texts
    .map((text, i) =>
      i < index ? text : i === index ? String(value).padStart(width, "0") : "0"
    )
    .join(".");

  const name = pattern.before + key + pattern.after;
  return {
    key,
    path: [...pattern.folders, name].join("/"),
    from: last.path,
    complete: !name.includes("*"),
    taken: members.some((member) => member.key === key),
  };
}
