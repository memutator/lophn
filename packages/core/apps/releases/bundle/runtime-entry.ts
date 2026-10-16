// 운영 앱의 실제 기동 진입 파일. 앱의 `main.ts`는
// command를 등록할 뿐이라 supervisor가 그것을 직접 띄우면 앱 runtime(broker 연결·command·화면 서버·문제 보고)이
// 뜨지 않는다. release 준비가 이 진입 파일을 bundle에 더하고 manifest의 entrypoint로 삼아 runtime entrypoint가
// `@lophn/app`(앱의 `main.ts`)을 불러 오게 한다. 진입 파일과 `@lophn/base` import map은 준비한 플랫폼 설치의
// 절대 경로를 가리키므로 그 설치에서 준비한 bundle만 그 설치에서 뜬다.
export const RUNTIME_ENTRY_PATH = "lophn-entry.ts";

// 운영 앱 자식이 `--config`로 읽는 플랫폼 설정이다. 앱의 deno.json은 읽지 않는다. 받아 둔 npm·jsr 의존은
// bundle 안 `vendor/`와 `node_modules/`에서 읽고(cache나 network 없이), 이 설정이 그 위치를 가리킨다.
export const RUNTIME_CONFIG_PATH = "lophn.json";

export type RuntimeEntry = {
  entrypoint: string;
  files: { path: string; bytes: Uint8Array }[];
  // 앱 import map에 더하는 플랫폼 specifier다. runtime entrypoint가 `@lophn/base`를 쓴다.
  imports: Record<string, string>;
};

// `packagesUrl`은 플랫폼 `packages/` 폴더의 file URL이다(끝에 `/`).
export function runtimeEntry(packagesUrl: string): RuntimeEntry {
  const module = JSON.stringify(
    `${packagesUrl}core/apps/runtime/entrypoint/main.ts`,
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
    }, {
      path: RUNTIME_CONFIG_PATH,
      bytes: new TextEncoder().encode(
        JSON.stringify({ vendor: true, nodeModulesDir: "manual" }),
      ),
    }],
    imports: { "@lophn/base": `${packagesUrl}base/mod.ts` },
  };
}
