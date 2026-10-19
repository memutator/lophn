// artifact 문서에는 tokens.css가 없으므로 token 정의 전체를 만들어 appearance CSS 앞에 붙인다.
// 글꼴 파일은 싣지 않는다. font token은 system-ui로 떨어진다.
import { flatten, renderCss } from "../../../design/flatten.ts";

export function artifactDocumentCss(appearance: string): string {
  return renderCss(flatten()) + appearance;
}
