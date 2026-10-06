import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  saveToolDocument,
  saveToolDocumentInputSchema,
  TOOL_DOCUMENT_ROUTES,
  TOOL_TEXT_MAX_BYTES,
  validateToolText,
  validateToolTextInputSchema,
} from "./tool-documents.ts";

const doc = "doc_01arz3ndektsv4rrffq69g5fav";
const ver = "ver_01arz3ndektsv4rrffq69g5fav";
const prj = "prj_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);

const created = {
  document: doc,
  base_version: null,
  metadata: {
    title: "기획",
    place: { kind: "project", id: prj },
    name: "plan",
  },
  text: "# 기획\n본문",
  media_type: "text/markdown",
  format: null,
  idempotency_key: "tcl_01arz3ndektsv4rrffq69g5fav",
};

Deno.test("lophn-agent/harness/tools#R6: 저장 route는 agent 자격의 worker route 둘이고 본문은 글 값으로만 받는다", () => {
  assertEquals(TOOL_DOCUMENT_ROUTES.map(routePath), [
    "/v1/tool-documents/save",
    "/v1/tool-documents/validate",
  ]);
  for (const route of TOOL_DOCUMENT_ROUTES) {
    assertEquals(route.kind, "worker");
    assertEquals(route.actors, ["agent"]);
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assertEquals(saveToolDocument.name, "SaveToolDocument");
  assertEquals(validateToolText.name, "ValidateToolText");
  assert(saveToolDocumentInputSchema.safeParse(created).success);
  // 새 문서는 자리·이름을 담은 metadata가 필요하고 기존 문서는 metadata가 없다.
  assertEquals(
    saveToolDocumentInputSchema.safeParse({ ...created, metadata: null })
      .success,
    false,
  );
  assertEquals(
    saveToolDocumentInputSchema.safeParse({ ...created, base_version: ver })
      .success,
    false,
  );
  assert(
    saveToolDocumentInputSchema.safeParse({
      ...created,
      base_version: ver,
      metadata: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/tools#R6: hash·blob·준비 참조·파일 목록을 싣는 입력과 공백·상한 초과 본문은 거절한다", () => {
  for (
    const extra of [
      { blob_hash: hash },
      { content_hash: hash },
      { preparation_ref: "prep-1" },
      { files: [] },
      { source: null },
      { actor: "agent:asg_01arz3ndektsv4rrffq69g5fav" },
    ]
  ) {
    assertEquals(
      saveToolDocumentInputSchema.safeParse({ ...created, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
  }
  for (const text of ["", "   \n", "\u0000본문"]) {
    assertEquals(
      saveToolDocumentInputSchema.safeParse({ ...created, text }).success,
      false,
      JSON.stringify(text),
    );
  }
  // 상한은 UTF-8 bytes다: 한글 3 byte 문자로 글자 수는 적어도 넘는다.
  const korean = "가".repeat(Math.floor(TOOL_TEXT_MAX_BYTES / 3));
  assert(
    saveToolDocumentInputSchema.safeParse({ ...created, text: korean }).success,
  );
  assertEquals(
    saveToolDocumentInputSchema.safeParse({ ...created, text: korean + "가" })
      .success,
    false,
  );
  // 허용 밖 형식은 거절한다.
  assertEquals(
    saveToolDocumentInputSchema.safeParse({
      ...created,
      media_type: "application/pdf",
    }).success,
    false,
  );
});

Deno.test("lophn-agent/harness/tools#R7: 본문 검사 입력은 format 지정·글 값·형식뿐이고 저장 입력을 받지 않는다", () => {
  const input = {
    format: { name: "document", module_hash: hash },
    text: "# 제목",
    media_type: "text/markdown",
  };
  assert(validateToolTextInputSchema.safeParse(input).success);
  assert(
    validateToolTextInputSchema.safeParse({ ...input, cursor: "100" }).success,
  );
  for (
    const extra of [
      { base_version: ver },
      { document: doc },
      { idempotency_key: "k" },
      { blob_hash: hash },
      { files: [] },
    ]
  ) {
    assertEquals(
      validateToolTextInputSchema.safeParse({ ...input, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
  }
  assertEquals(
    validateToolTextInputSchema.safeParse({ ...input, text: " " }).success,
    false,
  );
});
