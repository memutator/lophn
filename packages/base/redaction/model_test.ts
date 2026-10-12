import { assert, assertEquals } from "@std/assert";
import {
  isFieldPath,
  REDACTION_MAX_DEPTH,
  REDACTION_MAX_ITEMS,
  REDACTION_REPLACEMENT,
  REDACTION_SAMPLE_MAX_BYTES,
  REDACTION_SAMPLE_MAX_CHARS,
  REDACTION_SCREEN_STRING_MAX_CHARS,
  REDACTION_TIMEOUT_MS,
  REDACTION_UNIT_MAX_BYTES,
} from "./model.ts";

Deno.test("redaction 한도는 architecture 5.8과 같다", () => {
  assertEquals(REDACTION_UNIT_MAX_BYTES, 1024 * 1024);
  assertEquals(REDACTION_MAX_DEPTH, 16);
  assertEquals(REDACTION_MAX_ITEMS, 4096);
  assertEquals(REDACTION_TIMEOUT_MS, 5000);
  assertEquals(REDACTION_REPLACEMENT, "*");
  assertEquals(REDACTION_SAMPLE_MAX_CHARS, 64);
  assertEquals(REDACTION_SAMPLE_MAX_BYTES, 2 * 1024);
  assertEquals(REDACTION_SCREEN_STRING_MAX_CHARS, 80);
});

Deno.test("field 경로는 명시 경로만 받는다", () => {
  assert(isFieldPath("code"));
  assert(isFieldPath("items[0].name"));
  assert(!isFieldPath("*"));
  assert(!isFieldPath("items.*.name"));
  assert(!isFieldPath(""));
  assert(!isFieldPath(1));
});
