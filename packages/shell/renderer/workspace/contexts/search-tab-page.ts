// 선언된 검색의 한 page를 읽는다. cursor는 다음 page만 알려 주므로 앞 page부터
// 따라가며, 지나온 cursor는 cursors에 남겨 다음에 그 자리에서 이어 읽는다.
import type {
  ContextsSource,
  ReadResult,
  SearchPage,
  SearchRequest,
} from "./source.ts";

export async function loadPage(
  source: ContextsSource,
  request: Omit<SearchRequest, "cursor">,
  page: number,
  cursors: (string | undefined)[],
): Promise<ReadResult<SearchPage>> {
  let at = Math.min(page, cursors.length - 1);
  for (;;) {
    const cursor = cursors[at];
    const result = await source.search(
      cursor === undefined ? request : { ...request, cursor },
    );
    if (!result.ok) return result;
    const next = result.value.next_cursor;
    if (next === null) return result;
    cursors[at + 1] = next;
    if (at >= page) return result;
    at += 1;
  }
}
