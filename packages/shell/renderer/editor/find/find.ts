// 문서 안 찾기의 순수 규칙. 정규식 없이 글자 그대로 찾고 대소문자 구별 하나만 고른다.
import { t } from "@lophn/wording";

export interface Match {
  readonly from: number;
  readonly to: number;
}

interface FindOptions {
  readonly caseSensitive?: boolean;
  /** 이 개수를 넘으면 세기를 멈추고 "+"를 붙인다. */
  readonly cap?: number;
}

const MATCH_CAP = 1000;

/** text 안에서 query가 겹치지 않게 나오는 자리 전부. */
export function findMatches(
  text: string,
  query: string,
  options: FindOptions = {},
): Match[] {
  if (query === "") return [];
  const cap = options.cap ?? MATCH_CAP;
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  // 소문자로 바꾸면 길이가 달라지는 글자("İ")가 있으면 위치가 어긋난다. 그때는 그대로 찾는다.
  const exact =
    haystack.length !== text.length || needle.length !== query.length;
  const source = exact ? text : haystack;
  const target = exact ? query : needle;
  const out: Match[] = [];
  let at = source.indexOf(target);
  while (at !== -1 && out.length < cap) {
    out.push({ from: at, to: at + target.length });
    at = source.indexOf(target, at + target.length);
  }
  return out;
}

/** position 이후 첫 일치. 없으면 처음으로 돈다. 일치가 없으면 -1. */
export function nearestMatch(
  matches: readonly Match[],
  position: number,
): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.from >= position);
  return index === -1 ? 0 : index;
}

/** 다음(1)·이전(-1) 일치. 끝에서 돈다. */
export function stepMatch(
  index: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count === 0) return -1;
  if (index < 0) return direction === 1 ? 0 : count - 1;
  return (index + direction + count) % count;
}

/** 입력 옆 "3/12", "No matches", 상한이면 "1/1000+". */
export function findLabel(
  index: number,
  count: number,
  cap = MATCH_CAP,
): string {
  if (count === 0) return t("document.label.find-none");
  const current = index < 0 ? 0 : index + 1;
  return count >= cap
    ? t("document.label.find-count-capped", { current, total: cap })
    : t("document.label.find-count", { current, total: count });
}

/** 일치를 모두 바꾼 글과 바꾼 개수. */
export function replaceAll(
  text: string,
  matches: readonly Match[],
  replacement: string,
): { text: string; count: number } {
  let out = "";
  let last = 0;
  for (const match of matches) {
    out += text.slice(last, match.from) + replacement;
    last = match.to;
  }
  return { text: out + text.slice(last), count: matches.length };
}
