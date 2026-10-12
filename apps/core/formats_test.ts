// documents/formats#R8: format read는 선언·template·guide·예시·vocabulary를 내놓고
// 검사만으로 판 수가 늘지 않는다. core HTTP API 통합 테스트다.
import { assert, assertEquals } from "@std/assert";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { BUILTIN_MODULE_HASH } from "../../packages/core/projects/formats/guest/module-hash.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];

async function credential(harness: CoreHarness): Promise<string> {
  const issued = await harness.credential({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: ["format.list", "format.get"],
      targets: {},
    },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value.token;
}

function call(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function json(
  harness: CoreHarness,
  path: string,
  body: unknown,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await call(harness, path, body, token);
  const text = await response.text();
  assertEquals(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

Deno.test("documents/formats#R8: format 목록은 네 내장 format의 선언을 전부 내놓는다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const token = await credential(harness);
    const body = await json(harness, "formats/list", {}, token);
    const formats = body.formats as Record<string, unknown>[];
    assertEquals(
      formats.map((format) => format.name),
      ["document", "pdf", "image", "data"],
    );
    for (const format of formats) {
      assertEquals(format.module_hash, BUILTIN_MODULE_HASH);
      assert(Array.isArray(format.media_types));
      assert((format.media_types as unknown[]).length >= 1);
      // structure·metadata는 object다.
      assert(
        typeof format.structure === "object" && format.structure !== null,
      );
      assert(
        typeof format.metadata === "object" && format.metadata !== null,
      );
      // template·guide·vocabulary는 실행 전 읽을 내용이다.
      const template = format.template as Record<string, unknown>[];
      assert(Array.isArray(template) && template.length >= 1);
      assert(
        typeof template[0].path === "string" &&
          typeof template[0].blob_hash === "string",
      );
      const guide = format.guide as Record<string, unknown>;
      assert(typeof guide.text === "string" && guide.text.length > 0);
      assert(Array.isArray(guide.examples));
      assert(Array.isArray(format.vocabulary));
      // 검사 여부는 extracts 하나다.
      assertEquals(typeof format.extracts, "boolean");
      // read common: platform read처럼 as_of_seq·next_cursor를 둔다.
      assertEquals(body.as_of_seq, "0");
      assertEquals(body.next_cursor, null);
    }
  } finally {
    await harness.close();
  }
});

Deno.test("documents/formats#R8: format get은 name·module_hash를 검사하고 누락 module은 not_found다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const token = await credential(harness);

    const found = await json(harness, "formats/get", {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
    }, token);
    assertEquals(found.name, "document");
    assertEquals(found.media_types, [
      "text/markdown",
      "text/x-markdown",
      "text/html",
      "application/xhtml+xml",
      "text/plain",
    ]);
    const guide = found.guide as Record<string, unknown>;
    assert(typeof guide.text === "string" && guide.text.length > 0);
    assertEquals(found.as_of_seq, "0");
    assertEquals(found.next_cursor, null);

    const noModule = await call(harness, "formats/get", {
      name: "document",
      module_hash: "a".repeat(64),
    }, token);
    assertEquals(noModule.status, 404);
    const missing = await noModule.json();
    assertEquals(missing.error.code, "not_found");
    assertEquals(missing.error.message, "format module is missing");
  } finally {
    await harness.close();
  }
});

Deno.test("documents/formats#R8: format get의 잘못된 입력은 invalid_input이다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const token = await credential(harness);

    const empty = await call(harness, "formats/get", {}, token);
    assertEquals(empty.status, 400);
    assertEquals((await empty.json()).error.code, "invalid_input");

    const unknownName = await call(harness, "formats/get", {
      name: "spreadsheet",
      module_hash: BUILTIN_MODULE_HASH,
    }, token);
    assertEquals(unknownName.status, 400);
    assertEquals((await unknownName.json()).error.code, "invalid_input");
  } finally {
    await harness.close();
  }
});

Deno.test("documents/formats#R8: format read는 인증 없이는 닿지 않는다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const anonymous = await fetch(
      `http://127.0.0.1:${harness.port}/v1/formats/list`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assertEquals(anonymous.status, 401);
  } finally {
    await harness.close();
  }
});

Deno.test("documents/formats#R8: format read와 validate로도 문서 판 수는 그대로다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const token = await credential(harness);
    await json(harness, "formats/list", {}, token);
    await json(harness, "formats/get", {
      name: "document",
      module_hash: BUILTIN_MODULE_HASH,
    }, token);
    // 검사만으로 만든 version은 없다. 이 credential의 event 조회에 문서 event가 없다.
    const listed = await json(harness, "events/list", {
      after_seq: "0",
      limit: 100,
    }, token);
    const events = listed.events as { type?: string }[];
    assertEquals(
      events.filter((event) => (event.type ?? "").startsWith("documents."))
        .length,
      0,
    );
  } finally {
    await harness.close();
  }
});
