// documents/formats#R4, R5: 대표 파일이 검사 한도를 넘을 때의 검사 결과.
import { assert, assertEquals } from "@std/assert";
import { FORMAT_CHECK_CONTENT_MAX_BYTES } from "../../contracts/documents/mod.ts";
import { BUILTIN_MODULE_HASH } from "./guest/module-hash.ts";
import { CHECK_SKIPPED_CODE, overLimitOutcome } from "./check-limit.ts";

const HASH = "ab".repeat(32);

function primary(bytes: number) {
  return { path: "doc.md", bytes, blob_hash: HASH };
}

function format(name: string, explicit: boolean) {
  return { name, module_hash: BUILTIN_MODULE_HASH, explicit };
}

Deno.test("documents/formats#R4: 한도 이하의 대표 파일과 바이트를 읽지 않는 format은 결과를 만들지 않는다", () => {
  assertEquals(
    overLimitOutcome(
      primary(FORMAT_CHECK_CONTENT_MAX_BYTES),
      format("document", true),
    ),
    null,
  );
  for (const name of ["pdf", "image", "data"]) {
    assertEquals(
      overLimitOutcome(primary(500 * 1024 * 1024), format(name, true)),
      null,
    );
  }
});

Deno.test("documents/formats#R4: 명시 format은 한도를 밝힌 error와 failed다", () => {
  const over = FORMAT_CHECK_CONTENT_MAX_BYTES + 1;
  const outcome = overLimitOutcome(primary(over), format("document", true));
  assert(outcome !== null);
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.error_count, 1);
  assertEquals(outcome.warning_count, 0);
  assertEquals(outcome.input_hash, HASH);
  assertEquals(outcome.module_hash, BUILTIN_MODULE_HASH);
  const [diagnostic] = outcome.diagnostics;
  assertEquals(diagnostic.severity, "error");
  assertEquals(diagnostic.code, CHECK_SKIPPED_CODE);
  assertEquals(diagnostic.file, "doc.md");
  assert(diagnostic.message.includes(String(FORMAT_CHECK_CONTENT_MAX_BYTES)));
  assert(diagnostic.message.includes(String(over)));
});

Deno.test("documents/formats#R5: 미지정 format은 한도를 밝힌 warning이고 passed다", () => {
  const outcome = overLimitOutcome(
    primary(32 * 1024 * 1024),
    format("document", false),
  );
  assert(outcome !== null);
  assertEquals(outcome.status, "passed");
  assertEquals(outcome.error_count, 0);
  assertEquals(outcome.warning_count, 1);
  assertEquals(outcome.diagnostics[0].severity, "warning");
  assertEquals(outcome.diagnostics[0].code, CHECK_SKIPPED_CODE);
});
