// 자라는 code block을 줄 단위로 이어 칠한다. 끝난 줄은 다시 tokenize하지 않고 앞 줄의 grammar state에서 이어 간다.
import type { CodeLine } from "@lophn/ui/reading";

/** 이 길이를 넘는 code는 칠하지 않는다(plain). */
export const MAX_HIGHLIGHT_CHARS = 20_000;
/** 한 번 tokenize가 이보다 오래 걸리면 그 block은 settle(final)까지 plain이다. */
export const SLOW_MS = 500;

export interface Session<S> {
  readonly language: string;
  /** 끝난 줄(끝의 "\n" 포함)까지 이미 tokenize한 앞부분. */
  readonly text: string;
  readonly lines: readonly CodeLine[];
  readonly state: S | undefined;
  readonly slow: boolean;
}

export type Tokenize<S> = (
  text: string,
  state: S | undefined,
) => { lines: readonly CodeLine[]; state: S | undefined };

export function splitComplete(rest: string): {
  complete: string;
  tail: string;
} {
  const at = rest.lastIndexOf("\n");
  return { complete: rest.slice(0, at + 1), tail: rest.slice(at + 1) };
}

// final이 아니면 마지막 줄(아직 쓰는 중)은 빼고 끝난 줄만 낸다: lines는 code의 마지막 "\n" 앞까지다.
// 앞 session이 code의 앞부분이 아니면(고쳐 쓴 경우) 처음부터 다시 한다.
export function advance<S>(
  previous: Session<S> | undefined,
  code: string,
  language: string,
  final: boolean,
  tokenize: Tokenize<S>,
  now: () => number,
): { session: Session<S>; lines: readonly CodeLine[] | null } {
  const base: Session<S> =
    previous !== undefined &&
    previous.language === language &&
    code.startsWith(previous.text)
      ? previous
      : { language, text: "", lines: [], state: undefined, slow: false };
  if (base.slow && !final) return { session: base, lines: null };
  const { complete, tail } = splitComplete(code.slice(base.text.length));
  const started = now();
  let session = base;
  if (complete !== "") {
    // 끝의 "\n"은 줄 구분자라 빼고 넘긴다. 안 빼면 빈 줄이 하나 더 생긴다.
    const done = tokenize(complete.slice(0, -1), base.state);
    session = {
      ...base,
      text: base.text + complete,
      lines: [...base.lines, ...done.lines],
      state: done.state,
    };
  }
  let lines = session.lines;
  if (final && tail !== "") {
    lines = [...lines, ...tokenize(tail, session.state).lines];
  }
  if (now() - started > SLOW_MS) session = { ...session, slow: true };
  return { session, lines };
}
