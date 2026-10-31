// reading: 읽기 renderer. Markdown(Lezer)·code·diff·목차가 reading.module.css를 함께 쓴다.
// Markdown 문서를 읽는 글로 그린다. raw HTML은 실행하지 않는다. variant chat은 대화 글, code만 보일 때는 CodeBlock이다.
export { Markdown, type MarkdownProps } from "./markdown/markdown.tsx";
// Markdown을 그리지 않고 구조(목차 포함)만 필요할 때 쓰는 parser.
export { parseMarkdown, type ParseOptions } from "./markdown/parse.ts";
export type {
  Block,
  Inline,
  MarkdownDocument,
  OutlineItem,
} from "./markdown/model.ts";
// 바깥에서 온 link·image 주소를 허용 protocol만 남겨 정규화한다. 직접 a/img를 만들 때 쓴다.
export { safeUrl } from "./markdown/url.ts";
// code 한 덩어리를 복사 단추와 함께 보인다. 문서 전체가 아니라 code 조각 하나에 쓴다.
export { CodeBlock, type CodeBlockProps } from "./code-block/code-block.tsx";
// CodeBlock에 code highlighter를 준다. 없으면 code는 plain이다.
export {
  type CodeLine,
  type CodeToken,
  type Highlighter,
  HighlighterProvider,
} from "./code-block/highlighter.ts";
export type { DiffLine } from "./diff-view/diff-view.tsx";
// 줄 단위 unified diff를 표로 보이고 긴 것은 접어 둔다. 편집 카드처럼 좁은 자리에서 쓴다.
export { DiffView, type DiffViewProps } from "./diff-view/diff-view.tsx";
// 문서의 제목 목차. ReadingFrame이 정한 자리에 따라 옆 목록이나 머리 선택으로 그린다.
export { Toc, TOC_MAX_LEVEL, type TocProps } from "./toc/toc.tsx";
// diff 줄 앞의 +/− 기호. 색 없이도 추가·삭제를 읽게 줄 배경과 같이 쓴다.
export { type DiffKind, DiffMark } from "./diff-view/diff-mark.tsx";
