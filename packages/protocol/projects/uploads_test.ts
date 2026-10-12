import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import { ROUTES } from "./mod.ts";
import { hash } from "./document-fixtures.ts";
import { DOCUMENT_UPLOAD_MAX_BYTES, documentUpload } from "./uploads.ts";

Deno.test("coding-agent/mcp-server#R13: 파일 제출 route는 hash·크기만 JSON으로 받고 준비 참조를 돌려준다", () => {
  assertEquals(documentUpload.kind, "upload");
  assertEquals(routePath(documentUpload), "/v1/documents/upload");
  assertEquals(documentUpload.max_bytes, DOCUMENT_UPLOAD_MAX_BYTES);
  assertEquals(documentUpload.actors, ["user", "coding_agent", "app"]);
  assert(ROUTES.includes(documentUpload));
  assert(documentUpload.input.safeParse({ blob_hash: hash, bytes: 3 }).success);
  // 경로·MIME·purpose·principal은 호출자가 주장하지 않는다.
  for (
    const extra of [
      { path: "a.md" },
      { purpose: "document_file" },
      { principal: "machine" },
    ]
  ) {
    assertEquals(
      documentUpload.input.safeParse({ blob_hash: hash, bytes: 3, ...extra })
        .success,
      false,
    );
  }
  for (const bytes of [-1, 1.5, DOCUMENT_UPLOAD_MAX_BYTES + 1]) {
    assertEquals(
      documentUpload.input.safeParse({ blob_hash: hash, bytes }).success,
      false,
    );
  }
  const prepared = {
    preparation: "prep-1",
    principal: "cac",
    purpose: "document_file",
    hash,
    size_bytes: 3,
  };
  assert(documentUpload.output.safeParse(prepared).success);
});
