// composer의 ↑↓ 입력 history 넘기기 규칙. 목록은 새 것이 앞(0)이다. 입력칸과 캐럿 자리는 composer가 본다.

/** 넘기는 중의 자리. 넘기기를 시작하기 전 입력칸의 글은 `unsent`에 두고 ↓로 가장 새 글을 지나면 되돌린다. */
export interface HistoryBrowse {
  readonly index: number;
  readonly unsent: string;
}

export interface HistoryStep {
  readonly text: string;
  /** null이면 넘기기가 끝났다. */
  readonly browse: HistoryBrowse | null;
}

/** ↑: 글이 비었거나 이미 넘기는 중일 때 한 칸 더 오래된 글로 간다. 가장 오래된 글에서는 그 자리에 머문다. */
export function previousEntry(
  history: readonly string[],
  text: string,
  browse: HistoryBrowse | null,
): HistoryStep | null {
  if (history.length === 0) return null;
  if (browse === null && text !== "") return null;
  const index =
    browse === null ? 0 : Math.min(browse.index + 1, history.length - 1);
  return {
    text: history[index]!,
    browse: { index, unsent: browse?.unsent ?? text },
  };
}

/** ↓: 넘기는 중일 때만 한 칸 더 새 글로 간다. 가장 새 글을 지나면 넘기기 전 글로 돌아가고 넘기기가 끝난다. */
export function nextEntry(
  history: readonly string[],
  browse: HistoryBrowse | null,
): HistoryStep | null {
  if (browse === null) return null;
  if (browse.index === 0) return { text: browse.unsent, browse: null };
  const index = browse.index - 1;
  return { text: history[index]!, browse: { index, unsent: browse.unsent } };
}
