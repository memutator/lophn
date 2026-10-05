import { TEST_EXECUTION_LIMITS } from "../../../contracts/problems/mod.ts";
import { TEST_OBSERVATION_FRAME_MAX_BYTES } from "../../../contracts/problems/mod.ts";
import { TEST_OBSERVATION_SIDE_MAX_BYTES } from "../../../contracts/problems/mod.ts";

// problems/tests#R19, R20. 요청이 이 상한을 넓히지 못한다.
export const RUNNER_LIMITS = {
  concurrent: TEST_EXECUTION_LIMITS.concurrent,
  preparing: TEST_EXECUTION_LIMITS.preparing,
  timeout_ms: TEST_EXECUTION_LIMITS.timeout_ms,
  output_bytes_per_side: TEST_EXECUTION_LIMITS.output_bytes_per_side,
  process_memory_bytes: TEST_EXECUTION_LIMITS.process_memory_bytes,
  deno_heap_bytes: TEST_EXECUTION_LIMITS.deno_heap_bytes,
  frame_bytes: TEST_OBSERVATION_FRAME_MAX_BYTES,
  side_bytes: TEST_OBSERVATION_SIDE_MAX_BYTES,
  // problems/tests#R21. 미확정 spool 보관 상한.
  spool_ttl_ms: 24 * 60 * 60 * 1000,
} as const;

// Deno heap 268,435,456 bytes는 MiB 단위 V8 flag다.
export const DENO_HEAP_FLAG = "--v8-flags=--max-old-space-size=256";

export const FIXED_DENO_FLAGS = [
  "--no-prompt",
  "--cached-only",
  "--locked",
  DENO_HEAP_FLAG,
] as const;

// 자식에 넘겨도 되는 환경 이름. 값은 호출한 쪽이 명시한다.
export const SAFE_ENV_NAMES = [
  "NO_COLOR",
  "TZ",
  "LANG",
  "LC_ALL",
] as const;

export type SafeEnvName = (typeof SAFE_ENV_NAMES)[number];
