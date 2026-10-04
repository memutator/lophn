// guest 실행 규약. module_hash가 이 버전을 덮으므로 규약을 바꾸면 번호를 올린다.
export const GUEST_CONTRACT_VERSION = 1;

// architecture/documents 2.2 초기 조절값. domain 원문 크기 제한이 아니다.
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
