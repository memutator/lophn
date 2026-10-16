export const DEFAULT_API_PORT = 7431;

const KIB = 1024;

// 고정 안전 기본값.
export const RPC_JSON_MAX_BYTES = 256 * KIB;
export const RPC_JSON_MAX_DEPTH = 16;
export const RPC_JSON_MAX_ITEMS = 4096;
export const HEADER_MAX_BYTES = 8 * KIB;

// idempotency key는 UTF-8 1~128 bytes.
export const IDEMPOTENCY_KEY_MIN_BYTES = 1;
export const IDEMPOTENCY_KEY_MAX_BYTES = 128;

// event batch 256개·256KiB.
export const EVENT_BATCH_MAX_COUNT = 256;
