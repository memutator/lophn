// `[[` 링크 고르기의 순수 규칙: 여는 자리, 목록에 보일 것, 고른 뒤 문서에 넣을 글.
// 넣는 링크는 documents/addressing의 address를 가리키는 보통 Markdown 링크
// `[제목](place/document)`이다. `[[…]]` 표기는 아무도 읽지 않으므로 만들지 않는다.

export const TRIGGER = "[[";

/** 링크로 고를 수 있는 문서 하나. address는 documents/addressing의 모양이다. */
export interface LinkTarget {
  readonly address: string;
  readonly title: string;
  /** 줄 끝에 조용히 보이는 문서 이름. */
  readonly name: string;
}

/** 커서가 들어 있는 `[[`의 시작, 끝(커서), 그 뒤에 친 글. */
export interface Trigger {
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

/**
 * 커서가 들어 있는 `[[`와 그 뒤 글. `[[`는 붙어 있고 단어를 시작해야 한다.
 * `다시[[표기]]`처럼 문법을 적는 글이나 앞 줄에 남은 `[[`는 여는 자리가 아니다.
 */
export function triggerAt(text: string, cursor: number): Trigger | null {
  const at = Math.max(0, Math.min(cursor, text.length));
  const from = text.lastIndexOf(TRIGGER, Math.max(0, at - TRIGGER.length));
  if (from < 0 || from + TRIGGER.length > at) return null;
  if (from > 0 && /[\p{L}\p{N}]/u.test(text[from - 1]!)) return null;
  const query = text.slice(from + TRIGGER.length, at);
  if (/[\n\]]/.test(query)) return null;
  return { from, to: at, query };
}

// 0 제목이 query로 시작, 1 제목에 있음, 2 이름·address에 있음. 맞지 않으면 null.
function rank(target: LinkTarget, query: string): number | null {
  if (query === "") return 0;
  const title = target.title.toLowerCase();
  if (title.startsWith(query)) return 0;
  if (title.includes(query)) return 1;
  if (
    target.name.toLowerCase().includes(query) ||
    target.address.toLowerCase().includes(query)
  ) return 2;
  return null;
}

/** query에 맞는 문서를 좋은 순서로. 같은 순위 안에서는 받은 순서를 지킨다. */
export function linkRows(
  targets: readonly LinkTarget[],
  query: string,
): LinkTarget[] {
  const normalized = query.trim().toLowerCase();
  const hits: { target: LinkTarget; rank: number; at: number }[] = [];
  targets.forEach((target, at) => {
    const value = rank(target, normalized);
    if (value !== null) hits.push({ target, rank: value, at });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.at - b.at).map((hit) =>
    hit.target
  );
}

/** 제목을 일찍 끝내는 글자를 escape한다. */
export function escapeLinkTitle(title: string): string {
  return title.replace(/[[\]\\]/g, (char) => `\\${char}`);
}

/** 고른 문서가 문서에 들어갈 글. */
export function linkText(target: Pick<LinkTarget, "address" | "title">): string {
  return `[${escapeLinkTitle(target.title)}](${target.address})`;
}

/** 강조 index를 목록 안으로 돌린다. 빈 목록은 null. */
export function rowAt<T>(rows: readonly T[], index: number): T | null {
  if (rows.length === 0) return null;
  return rows[((index % rows.length) + rows.length) % rows.length]!;
}
