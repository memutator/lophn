// 운영 앱의 실제 기동 진입 파일. 앱의 `main.ts`는 command를 등록할 뿐이라 supervisor가 그것을 직접 띄우면
// 앱 runtime(broker 연결·command·화면 서버, 예외를 앱 log에 쓰는 일)이 뜨지 않는다. release 준비가 이 진입
// 파일을 bundle에 더하고 manifest의 entrypoint로 삼아 runtime entrypoint가 앱의 `main.ts`를 불러 오게 한다.
// 진입 파일의 import는 준비한 플랫폼 설치의 절대 경로를 가리키므로 그 설치에서 준비한 bundle만 그 설치에서 뜬다.
export const RUNTIME_ENTRY_PATH = "lophn-entry.ts";

type RuntimeEntry = {
  entrypoint: string;
  files: { path: string; bytes: Uint8Array }[];
};

// `entrypointUrl`은 플랫폼 앱 진입점(`dist/app-entrypoint.mjs` 또는 `packages/core/apps/runtime/entrypoint/main.ts`)의 file URL이다.
// 기존 `packages/` 폴더 URL(끝이 `/`)을 넘겨도 진입 파일 경로로 이어 준다.
export function runtimeEntry(entrypointUrl: string): RuntimeEntry {
  const target = entrypointUrl.endsWith("/")
    ? `${entrypointUrl}core/apps/runtime/entrypoint/main.ts`
    : entrypointUrl;
  const module = JSON.stringify(target);
  const source = `// lophn이 만든 진입 파일이다. 앱 code는 \`main.ts\`다.
import { run } from ${module};

await run(new URL("./main.ts", import.meta.url).href);
`;
  return {
    entrypoint: RUNTIME_ENTRY_PATH,
    files: [
      {
        path: RUNTIME_ENTRY_PATH,
        bytes: new TextEncoder().encode(source),
      },
    ],
  };
}
