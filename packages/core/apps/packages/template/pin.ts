// 내장 템플릿의 고정 값. 템플릿 파일을 바꾸면 hash도 바뀐다. 공개한 판을 조용히 바꾸지 않도록 값은 템플릿과 같은 PR에서만 바꾼다.
import type { PackageRef } from "./import-map.ts";

// 앱이 직접 쓰는 SDK Package. 설치 사본의 import를 따라 필요한 지원 소스는 import map이 더한다.
export const TEMPLATE_ROOTS: readonly PackageRef[] = [
  { name: "@lophn/blueprint", version: "1.0.0" },
  { name: "@lophn/cap-problem", version: "1.0.0" },
  { name: "@lophn/cap-app-api", version: "1.0.0" },
  { name: "@lophn/cap-store", version: "1.0.0" },
  { name: "@lophn/ui-control", version: "1.0.0" },
  { name: "@lophn/ui-layout", version: "1.0.0" },
  { name: "@lophn/ui-state", version: "1.0.0" },
];

// 설치 사본의 import에는 없지만 앱 화면과 개발 도구가 직접 쓰는 npm·jsr 이름. 정확한 pin은 설치된 Package의
// deno.json에서 찾는다. JSX runtime은 compilerOptions의 jsxImportSource가 불러 낸다.
export const TEMPLATE_EXTRA_IMPORTS: readonly string[] = [
  "@luca/esbuild-deno-loader",
  "@types/react",
  "@types/react/jsx-runtime",
  "esbuild",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
];

// 시험·개발 도구만 쓰는 pin. 설치 Package의 deno.json에는 없다(저장소 root deno.json과 같아야 한다).
export const TEMPLATE_TOOL_IMPORTS: Readonly<Record<string, string>> = {
  "@std/assert": "jsr:@std/assert@1.0.19",
};

export const TEMPLATE_HASH =
  "3e1f17a71cb4bd03de917cf95be87081f781b6dfea99190293679fdcd6e89b83";
