import { assertEquals } from "@std/assert";
import {
  API_MAJOR,
  DEFAULT_API_PORT,
  HEADER_MAX_BYTES,
  IDEMPOTENCY_KEY_MAX_BYTES,
  IDEMPOTENCY_KEY_MIN_BYTES,
  RPC_JSON_MAX_BYTES,
  RPC_JSON_MAX_DEPTH,
  RPC_JSON_MAX_ITEMS,
} from "./limits.ts";

Deno.test(
  "platform/security#R8: RPC JSON·header 한도는 고정 안전 기본값이다",
  () => {
    assertEquals(RPC_JSON_MAX_BYTES, 256 * 1024);
    assertEquals(RPC_JSON_MAX_DEPTH, 16);
    assertEquals(RPC_JSON_MAX_ITEMS, 4096);
    assertEquals(HEADER_MAX_BYTES, 8 * 1024);
  },
);

Deno.test(
  "platform/api#R1: 기본 port는 7431이고 major는 1뿐",
  () => {
    assertEquals(DEFAULT_API_PORT, 7431);
    assertEquals(API_MAJOR, 1);
  },
);

Deno.test(
  "platform/ledger#R13: idempotency key는 UTF-8 1~128 bytes다",
  () => {
    assertEquals(IDEMPOTENCY_KEY_MIN_BYTES, 1);
    assertEquals(IDEMPOTENCY_KEY_MAX_BYTES, 128);
  },
);
