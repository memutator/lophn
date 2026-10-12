// `/v1/formats/validate` route 조립 테스트다(coding-agent#T14, mcp#R14). 검사 통로는
// 끼운 port다. 요청 주체가 준비해 살아 있는 blob만 읽는지, 진단이 page로 이어지는지,
// 통로 실패를 통과로 꾸미지 않는지 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import {
  formatValidate,
  formatValidationPageSchema,
} from "../../../../protocol/projects/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../../protocol/server/mod.ts";
import { filesHash } from "../../versions/mod.ts";
import { canonicalFilesHash } from "../../../../coding-agent/connection/mod.ts";
import { formatValidateRoute } from "./format-validate.ts";

const HASH = "ab".repeat(32);
const FORMAT_HASH = "cd".repeat(32);

function file(over: Record<string, unknown> = {}) {
  return {
    path: "plan.md",
    media_type: "text/markdown",
    bytes: 3,
    blob_hash: HASH,
    primary: true,
    content: {
      kind: "prepared",
      blob: {
        preparation: "prep-1",
        principal: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        purpose: "document_file",
        hash: HASH,
        size_bytes: 3,
      },
    },
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    name: "document",
    module_hash: FORMAT_HASH,
    files: [file()],
    input_hash: HASH,
    explicit: true,
    ...over,
  };
}

const PRINCIPAL = "coding_agent:cac_01arz3ndektsv4rrffq69g5fav";

function diagnostic(index: number) {
  return {
    severity: index % 2 === 0 ? "error" as const : "warning" as const,
    code: "invalid_structure",
    message: `문제 ${index}`,
    file: "plan.md",
    start_line: index + 1,
    end_line: index + 1,
    column: null,
  };
}

function route(
  over: {
    diagnostics?: number;
    live?: boolean;
    principal?: string | undefined;
    validate?: "ok" | "unavailable" | "not_found";
    pageSize?: number;
  } = {},
) {
  const seen: { files: unknown; format: unknown }[] = [];
  const count = over.diagnostics ?? 0;
  const diagnostics = Array.from(
    { length: count },
    (_, index) => diagnostic(index),
  );
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const built = formatValidateRoute({
    validate: (files, format) => {
      seen.push({ files, format });
      if (over.validate === "unavailable") {
        return Promise.resolve(
          err({ code: "unavailable" as const, message: "runner down" }),
        );
      }
      if (over.validate === "not_found") {
        return Promise.resolve(
          err({ code: "not_found" as const, message: "no format" }),
        );
      }
      return Promise.resolve(ok({
        input_hash: HASH,
        module_hash: FORMAT_HASH,
        status: errors === 0 ? "passed" as const : "failed" as const,
        error_count: errors,
        warning_count: count - errors,
        diagnostics,
      }));
    },
    principalOf: () => "principal" in over ? over.principal : PRINCIPAL,
    live: () => over.live ?? true,
    available: () => true,
    observedAt: () => "2026-10-06T00:00:00.000Z",
    ...(over.pageSize === undefined ? {} : { pageSize: over.pageSize }),
  });
  return { ...built, seen };
}

async function ask(
  built: ReturnType<typeof route>,
  body: unknown,
): Promise<WorkerResponse> {
  const request: WorkerRequest = {
    type: "worker_request",
    request_id: "cred-1/1",
    op: formatValidate.name,
    payload: body,
  };
  const answer = await built.handle.forward(request);
  assert(answer.ok);
  return answer.value;
}

Deno.test("coding-agent/mcp-server#R14: 요청 주체가 준비해 살아 있는 blob만 검사하고 파일 목록을 format 실행에 넘긴다", async () => {
  const built = route({ diagnostics: 0 });
  const response = await ask(built, payload());
  assert(response.ok);
  assertEquals(
    (response.payload as { status: string; complete: boolean }).status,
    "passed",
  );
  assert(formatValidationPageSchema.safeParse(response.payload).success);
  assertEquals(built.seen[0].format, {
    name: "document",
    module_hash: FORMAT_HASH,
    explicit: true,
  });
  assertEquals(built.seen[0].files, [{
    path: "plan.md",
    blob_hash: HASH,
    bytes: 3,
    media_type: "text/markdown",
    primary: true,
  }]);
});

Deno.test("coding-agent/mcp-server#R14: 남의 blob·만기 blob·credential 없는 요청은 검사하지 않는다", async () => {
  const foreign = route();
  const other = await ask(
    foreign,
    payload({
      files: [file({
        content: {
          kind: "prepared",
          blob: {
            preparation: "prep-2",
            principal: "coding_agent:cac_01arz3ndektsv4rrffq69g5faw",
            purpose: "document_file",
            hash: HASH,
            size_bytes: 3,
          },
        },
      })],
    }),
  );
  assert(!other.ok);
  assertEquals(other.error.code, "invalid_input");
  const expired = route({ live: false });
  const old = await ask(expired, payload());
  assert(!old.ok);
  assertEquals(old.error.code, "invalid_input");
  const missing = route({ principal: undefined });
  const noCredential = await ask(missing, payload());
  assert(!noCredential.ok);
  assertEquals(noCredential.error.code, "unauthorized");
  assertEquals(
    foreign.seen.length + expired.seen.length + missing.seen.length,
    0,
  );
  // 이미 있는 영구 참조를 읽는 길은 이 route에 없다.
  const existing = await ask(
    route(),
    payload({
      files: [file({
        content: {
          kind: "existing",
          reference: {
            owner_kind: "document_version",
            owner_key: "ver:1",
            field: "file",
            hash: HASH,
            registered_seq: "1",
          },
        },
      })],
    }),
  );
  assert(!existing.ok);
});

Deno.test("coding-agent/mcp-server#R14: 진단이 많으면 cursor로 이어 읽고 page 합이 총수와 같다", async () => {
  const built = route({ diagnostics: 5, pageSize: 2 });
  const collected: unknown[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 5; pages++) {
    const response = await ask(
      built,
      payload(cursor === undefined ? {} : { cursor }),
    );
    assert(response.ok);
    const page = formatValidationPageSchema.parse(response.payload);
    collected.push(...page.diagnostics);
    assertEquals(page.error_count, 3);
    assertEquals(page.warning_count, 2);
    if (page.complete) {
      assertEquals(page.next_cursor, null);
      break;
    }
    cursor = page.next_cursor!;
  }
  assertEquals(collected.length, 5);
  const bad = await ask(built, payload({ cursor: "abc" }));
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
  const past = await ask(built, payload({ cursor: "9" }));
  assert(!past.ok);
});

Deno.test("coding-agent/mcp-server#R14: 검사 통로가 끊기면 통과로 꾸미지 않고 unavailable이다", async () => {
  const down = await ask(route({ validate: "unavailable" }), payload());
  assert(!down.ok);
  assertEquals(down.error.code, "unavailable");
  const none = await ask(route({ validate: "not_found" }), payload());
  assert(!none.ok);
  assertEquals(none.error.code, "not_found");
  const bad = await ask(route(), { name: "document" });
  assert(!bad.ok);
  assertEquals(bad.error.code, "invalid_input");
});

Deno.test("coding-agent/mcp-server#R14: 통로가 계산하는 입력 hash는 documents의 content_hash 정의와 같다", async () => {
  const files = [
    {
      path: "plan.md",
      blob_hash: HASH,
      bytes: 3,
      media_type: "text/markdown",
      primary: true,
    },
    {
      path: "extra.txt",
      blob_hash: "ef".repeat(32),
      bytes: 5,
      media_type: "text/plain",
      primary: false,
    },
  ];
  assertEquals(await canonicalFilesHash(files), await filesHash(files));
});
