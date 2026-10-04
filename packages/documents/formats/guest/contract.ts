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
