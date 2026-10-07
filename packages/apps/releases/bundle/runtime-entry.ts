// 운영 앱의 실제 기동 진입 파일(architecture/apps 2.2, 2.3의 "bundle의 플랫폼 entrypoint"). 앱의 `main.ts`는
// command를 등록할 뿐이라 supervisor가 그것을 직접 띄우면 앱 runtime(broker 연결·command·화면 서버·문제 보고)이
// 뜨지 않는다. release 준비가 이 진입 파일을 bundle에 더하고 manifest의 entrypoint로 삼아 runtime entrypoint가
// `@lophn/app`(앱의 `main.ts`)을 불러 오게 한다. 진입 파일과 `@lophn/base` import map은 준비한 플랫폼 설치의
// 절대 경로를 가리키므로 그 설치에서 준비한 bundle만 그 설치에서 뜬다.
export const RUNTIME_ENTRY_PATH = "lophn-entry.ts";

export type RuntimeEntry = {
  entrypoint: string;
  files: { path: string; bytes: Uint8Array }[];
  // 앱 import map에 더하는 플랫폼 specifier다. runtime entrypoint가 `@lophn/base`를 쓴다.
  imports: Record<string, string>;
};

// `packagesUrl`은 플랫폼 `packages/` 폴더의 file URL이다(끝에 `/`).
export function runtimeEntry(packagesUrl: string): RuntimeEntry {
  const module = JSON.stringify(
    `${packagesUrl}apps/runtime/entrypoint/main.ts`,
  );
  const source =
    `// lophn이 만든 진입 파일이다. 앱 code는 \`@lophn/app\`(main.ts)이다.
import { run } from ${module};

await run();
`;
  return {
    entrypoint: RUNTIME_ENTRY_PATH,
    files: [{
      path: RUNTIME_ENTRY_PATH,
      bytes: new TextEncoder().encode(source),
    }],
    imports: { "@lophn/base": `${packagesUrl}base/mod.ts` },
  };
}
