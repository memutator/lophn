// guest 실행 규약. module_hash가 이 버전을 덮으므로 규약을 바꾸면 번호를 올린다.
export const GUEST_CONTRACT_VERSION = 1;

// 추출 규약 번호. 추출 규칙을 바꾸면 이 번호를 올리고, 같은 hash 아래 규칙을
// 덮어쓰지 않는다. 정본은 이 자리고 module-hash.ts·bundle.ts가 같은 근원으로 쓴다.
export const EXTRACTION_RULES_VERSION = 1;

// 초기 조절값. domain 원문 크기 제한이 아니다.
export const GUEST_MEMORY_BYTES = 64 * 1024 * 1024;
export const GUEST_CALL_TIMEOUT_MS = 5_000;
export const GUEST_INPUT_MAX_BYTES = 16 * 1024 * 1024;
export const GUEST_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

// runner 프로세스 heap. guest 64MiB와 host 여유를 남기고 무한 성장은 막는다.
export const RUNNER_HEAP_MIB = 256;
export const RUNNER_CONCURRENCY = 2;

export const BUNDLE_PATH = new URL("./bundle.js", import.meta.url);

// runner host가 읽는 내장 wasm. quickjs-emscripten specifier resolve로 Deno npm
// cache의 @jitl/quickjs-wasmfile-release-sync를 찾는다. cache 위치를 새로 두지 않는다.
// runner client의 spawn flags와 launcher의 launch spec이 같은 근원으로 쓴다.
export function runnerWasmPath(): string {
  const resolved = import.meta.resolve("quickjs-emscripten");
  // 설치 묶음은 의존성을 platform/node_modules에 두고 cache 없이 시작한다.
  // wasm 패키지의 실제 자리는 같은 version의 `.deno/@jitl+quickjs-wasmfile-release-sync@<version>`이다.
  const installed = resolved.match(
    /^(file:\/\/\/.+\/node_modules\/\.deno\/)quickjs-emscripten@([^/]+)\/node_modules\/quickjs-emscripten\/dist\//,
  );
  if (installed) {
    return decodeURIComponent(
      `${installed[1]}@jitl+quickjs-wasmfile-release-sync@${
        installed[2]
      }/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm`,
    ).slice("file://".length);
  }
  const match = resolved.match(
    /^(file:\/\/\/.+\/npm\/registry\.npmjs\.org\/)quickjs-emscripten(\/[^/]+)\/dist\//,
  );
  if (!match) {
    throw new Error("quickjs-emscripten cache layout is not recognized");
  }
  return decodeURIComponent(
    `${match[1]}@jitl/quickjs-wasmfile-release-sync${
      match[2]
    }/dist/emscripten-module.wasm`,
  ).slice("file://".length);
}
