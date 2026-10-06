// Markdown·목차·code block·문서 주소 표시(apps/sdk#R16). Markdown·code block·목차와 읽기 틀은
// lophn 문서 화면과 같은 component다. raw HTML과 script는 실행하지 않고 글로 보인다.
export {
  DocumentAddress,
  type DocumentAddressProps,
} from "./document-address.tsx";
export {
  type Block,
  CodeBlock,
  type CodeBlockProps,
  type Inline,
  Markdown,
  type MarkdownDocument,
  type MarkdownProps,
  type OutlineItem,
  parseMarkdown,
  type ParseOptions,
  Toc,
  TOC_MAX_LEVEL,
  type TocProps,
} from "@lophn/design/reading";
export {
  type Clipboard,
  READING_WIDTHS,
  ReadingFrame,
  type ReadingFrameProps,
  type ReadingWidth,
  systemClipboard,
} from "@lophn/design/components";
