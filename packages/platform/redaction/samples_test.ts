import { assert, assertEquals } from "@std/assert";
import {
  REDACTION_REPLACEMENT,
  REDACTION_SAMPLE_MAX_BYTES,
  REDACTION_SAMPLE_MAX_CHARS,
} from "../../contracts/platform/mod.ts";
import { redactSample, samplePathsAllowed } from "./samples.ts";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const HEX = "0123456789abcdef";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

Deno.test("R10 UUID·16자 hex·ULID는 표본 안 가명이고 명시 경로는 64자, 전체는 2KiB다", () => {
  const long = "n".repeat(REDACTION_SAMPLE_MAX_CHARS + 12);
  const sample = redactSample(
    {
      title: long,
      owner: UUID,
      digest: HEX,
      event: ULID,
      again: UUID,
      other: "plain",
      nested: { note: "kept-note" },
    },
    ["title", "other", "nested.note"],
  );
  assert(sample.ok);
  const value = sample.value as Record<string, unknown>;
  assertEquals((value.title as string).length, REDACTION_SAMPLE_MAX_CHARS);
  assertEquals(value.other, "plain");
  assertEquals(
    (value.nested as Record<string, unknown>).note,
    "kept-note",
  );
  assertEquals(value.owner, value.again);
  assert(typeof value.owner === "string");
  assert(!String(value.owner).includes(UUID.slice(0, 8)));
  assertEquals(value.digest !== HEX, true);
  assertEquals(value.event !== ULID, true);
  assertEquals(value.owner !== value.digest, true);
  const encoded = JSON.stringify(value);
  assert(!encoded.includes(UUID));
  assert(!encoded.includes(HEX));
  assert(!encoded.includes(ULID));
  assert(sample.bytes <= REDACTION_SAMPLE_MAX_BYTES);

  const unmarked = redactSample({ secretish: "not-declared" }, ["title"]);
  assert(unmarked.ok);
  assertEquals(
    (unmarked.value as Record<string, unknown>).secretish,
    REDACTION_REPLACEMENT,
  );
});

Deno.test("R10 표본이 2KiB를 넘으면 원문 없이 한도 초과다", () => {
  const wide = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`k${index}`, "m".repeat(60)]),
  );
  const paths = Object.keys(wide);
  const over = redactSample(wide, paths);
  assert(!over.ok);
  if (!over.ok) assertEquals(over.reason, "limit_exceeded");
  assert(!JSON.stringify(over).includes("mmmm"));
});

Deno.test("R11 단독·중간 wildcard 표본 경로는 거절하고 개별 경로만 허용한다", () => {
  assertEquals(samplePathsAllowed(["*"]), false);
  assertEquals(samplePathsAllowed(["rows.*.id"]), false);
  assertEquals(samplePathsAllowed(["rows[0].id"]), true);
  const rejected = redactSample({ rows: [{ id: "keep" }] }, ["*"]);
  assert(!rejected.ok);
  if (!rejected.ok) assertEquals(rejected.reason, "invalid_input");
  const middle = redactSample({ rows: [{ id: "keep" }] }, ["rows.*.id"]);
  assert(!middle.ok);
  const accepted = redactSample({ rows: [{ id: "keep" }] }, ["rows[0].id"]);
  assert(accepted.ok);
  if (accepted.ok) {
    const rows = accepted.value as { rows: { id: string }[] };
    assertEquals(rows.rows[0].id, "keep");
  }
});
