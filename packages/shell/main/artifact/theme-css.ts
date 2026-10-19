// artifact 문서에는 tokens.css가 없으므로 token 정의 전체를 여기서 만들어 appearance CSS 앞에 붙인다.
// generate.ts의 renderCss와 같은 모양이다(그 file은 top-level await가 있어 main에서 import하지 못한다).
// 글꼴 파일은 싣지 않는다. font token은 system-ui로 떨어진다.
import { flatten } from "../../../design/flatten.ts";

export function artifactDocumentCss(appearance: string): string {
  const flat = flatten();
  const light = flat.map((token) => `  ${token.name}: ${token.light};`);
  const dark = flat.filter((token) => token.dark !== undefined).map((token) =>
    `  ${token.name}: ${token.dark};`
  );
  return [
    ":root {",
    "  color-scheme: light;",
    ...light,
    "}",
    '[data-theme="dark"] {',
    "  color-scheme: dark;",
    ...dark,
    "}",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    "    color-scheme: dark;",
    ...dark.map((line) => `  ${line}`),
    "  }",
    "}",
    appearance,
  ].join("\n");
}
