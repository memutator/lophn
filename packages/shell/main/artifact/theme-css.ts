// artifact 문서에는 tokens.css가 없으므로 token 정의 전체를 만들어 appearance CSS 앞에 붙인다.
// 글꼴 파일은 싣지 않는다. font token은 system-ui로 떨어진다.
import { flatten, renderCss } from "../../../design/flatten.ts";

// scroll 막대는 page가 고르는 것이 아니라 lophn 모양이라 kit을 쓰지 않는 page에도 넣는다. `design/base.css`의 같은
// 규칙 사본이다: base.css를 통째로 넣으면 body 배경·글꼴 file까지 와서 page와 부딪치고, shell main은 CSS file을 읽지 못한다.
const SCROLLBAR_CSS = `
::-webkit-scrollbar {
  width: var(--space-4);
  height: var(--space-4);
  background: transparent;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-corner {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  border: var(--space-1) solid transparent;
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
  background-clip: padding-box;
}
`;

export function artifactDocumentCss(appearance: string): string {
  return renderCss(flatten()) + SCROLLBAR_CSS + appearance;
}
