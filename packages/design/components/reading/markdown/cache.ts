// 끝난 글의 parse 결과 memo. 탭 전환·가상화로 다시 mount되는 글이 다시 parse되지 않게 한다.
// 쓰는 중인 글은 delta마다 달라 넣지 않는다. 항목 수와 글 길이를 둘 다 제한하므로 메모리는 한정된다.
import type { MarkdownDocument } from "./model.ts";
import { parseMarkdown } from "./parse.ts";

const MAX_ENTRIES = 64;
const MAX_SOURCE_LENGTH = 100_000;

const memo = new Map<string, MarkdownDocument>();

// 결과는 읽기만 한다. resolveImage가 있으면 결과가 호출자마다 달라 caching하지 않는다.
export function parseCached(source: string): MarkdownDocument {
  const hit = memo.get(source);
  if (hit !== undefined) {
    // Map은 넣은 순서를 지키므로 다시 넣으면 가장 최근이 된다.
    memo.delete(source);
    memo.set(source, hit);
    return hit;
  }
  const document = parseMarkdown(source);
  if (source.length <= MAX_SOURCE_LENGTH) {
    memo.set(source, document);
    if (memo.size > MAX_ENTRIES) memo.delete(memo.keys().next().value!);
  }
  return document;
}
