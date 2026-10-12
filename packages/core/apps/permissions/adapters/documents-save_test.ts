// documents/versions#R14, apps/blueprint#R13: broker의 DocumentsSave port를 앱 자격의 실제 저장
// 통로(upload → prepare → save)에 잇는 어댑터. core·documents는 fake client로 대신하고 실제
// core와 이어 보는 시험은 packages/core/projects/versions/app-output-core_test.ts가 한다.
import { assert, assertEquals } from "@std/assert";
import { err, type LophnError, ok, type Result } from "../../../../base/mod.ts";
import {
  documentList,
  documentPrepare,
  documentSave,
  documentUpload,
} from "../../../../protocol/projects/mod.ts";
import type { Route } from "../../../../protocol/base/mod.ts";
import {
  appDocumentId,
  type AppOutputFile,
  createAppDocumentsSave,
  type DocumentsClient,
} from "./documents-save.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);
const FORMAT = { name: "document", module_hash: HASH, explicit: true };
const VER1 = "ver_01arz3ndektsv4rrffq69g5fv1";
const VER2 = "ver_01arz3ndektsv4rrffq69g5fv2";

type Call = { kind: string; route: string; input: unknown; extra?: unknown };

function outputFile(overrides: Partial<AppOutputFile> = {}): AppOutputFile {
  const bytes = new TextEncoder().encode("# 주간 보고\n");
  return {
    path: "report.md",
    media_type: "text/markdown",
    bytes: bytes.length,
    blob_hash: HASH,
    primary: true,
    open: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    ...overrides,
  };
}

type World = ReturnType<typeof world>;

function world(options: {
  existing?: { id: string; name: string; latest: string };
  files?: readonly AppOutputFile[];
  uploadHash?: string;
  declared?: boolean;
  prepareFails?: LophnError;
  saveStatus?: "saved" | "unchanged";
} = {}) {
  const calls: Call[] = [];
  const client: DocumentsClient = {
    command(route, body) {
      calls.push({
        kind: "command",
        route: route.name,
        input: body.input,
        extra: { key: body.idempotency_key, compare: body.compare },
      });
      return Promise.resolve(ok({
        status: options.saveStatus ?? "saved",
        document: (body.input as { document: string }).document,
        version: VER2,
        reference: {},
        warnings: [],
        event_seq: "9",
      }));
    },
    read(route: Route, input) {
      calls.push({ kind: "read", route: route.name, input });
      if (route === documentList) {
        return Promise.resolve(ok({
          documents: options.existing === undefined ? [] : [{
            document: { id: options.existing.id, name: options.existing.name },
            latest_version: { id: options.existing.latest },
          }],
          next_cursor: null,
        }));
      }
      if (route === documentPrepare) {
        if (options.prepareFails) {
          return Promise.resolve(err(options.prepareFails));
        }
        return Promise.resolve(ok({
          ...(input as object),
          preparation_ref: "prep-1",
        }));
      }
      return Promise.resolve(err({ code: "internal", message: "unexpected" }));
    },
    async upload(route, input, bytes) {
      // 본문을 끝까지 읽어 소비한다. 읽은 바이트 수는 core가 맞춰 본다.
      let size = 0;
      for await (const chunk of bytes) size += chunk.byteLength;
      calls.push({
        kind: "upload",
        route: route.name,
        input,
        extra: { size },
      });
      const claimed = input as { blob_hash: string; bytes: number };
      return ok({
        preparation: "blobprep-1",
        principal: `app:${APP}`,
        purpose: "document_file",
        hash: options.uploadHash ?? claimed.blob_hash,
        size_bytes: claimed.bytes,
      });
    },
  };
  const adapter = createAppDocumentsSave({
    client: () => Promise.resolve(ok(client)),
    output: {
      files: () => Promise.resolve(ok(options.files ?? [outputFile()])),
    },
    declarations: {
      get: () =>
        Promise.resolve(ok(
          options.declared === false
            ? null
            : { name: "주간 보고", format: FORMAT },
        )),
    },
  });
  return { adapter, calls };
}

function request(
  overrides: Partial<Parameters<World["adapter"]["save"]>[0]> = {},
) {
  return {
    app: APP,
    release: REL,
    place: { kind: "app" as const, app: APP },
    key: "weekly-report",
    baseVersion: null,
    idempotencyKey: "report-1",
    ...overrides,
  };
}

function fail<T>(result: Result<T, LophnError>): LophnError {
  assert(!result.ok);
  return result.error;
}

Deno.test("documents/versions#R14: 첫 저장은 앱 place·출력 이름·app source로 bytes를 올려 준비하고 저장한다", async () => {
  const { adapter, calls } = world();
  const saved = await adapter.save(request());
  assert(saved.ok);
  assertEquals(saved.value, { saved: true, version: VER2 });
  // 순서: 자리 목록 → upload → prepare → save.
  assertEquals(calls.map((call) => call.route), [
    documentList.name,
    documentUpload.name,
    documentPrepare.name,
    documentSave.name,
  ]);
  assertEquals(calls[0].input, { place: { kind: "app", id: APP } });
  // 선언한 hash와 크기만 core로 간다. 읽은 bytes는 upload body로만 간다.
  assertEquals(calls[1].input, { blob_hash: HASH, bytes: 16 });
  const prepare = calls[2].input as Record<string, unknown>;
  const document = await appDocumentId(APP, "weekly-report", "report-1");
  assertEquals(prepare.document, document);
  assertEquals(prepare.base_version, null);
  assertEquals(prepare.metadata, {
    title: "주간 보고",
    place: { kind: "app", id: APP },
    name: "weekly-report",
  });
  assertEquals(prepare.format, FORMAT);
  assertEquals(prepare.source, { kind: "app", app: APP, release: REL });
  assertEquals(prepare.idempotency_key, "report-1");
  const files = prepare.files as { content: { kind: string } }[];
  assertEquals(files.length, 1);
  assertEquals(files[0].content.kind, "prepared");
  // 저장은 준비 결과와 기준 판 CAS, 같은 재전송 key를 묶는다.
  assertEquals(calls[3].extra, {
    key: "report-1",
    compare: { base_version: null },
  });
});

Deno.test("documents/versions#R14: 같은 key로 다시 저장하면 같은 Document의 기준 판 위 새 판이고 선언 format을 다시 걸지 않는다", async () => {
  const document = await appDocumentId(APP, "weekly-report", "report-1");
  const { adapter, calls } = world({
    existing: { id: document, name: "weekly-report", latest: VER1 },
  });
  const saved = await adapter.save(
    request({ baseVersion: VER1, idempotencyKey: "report-2" }),
  );
  assert(saved.ok);
  const prepare = calls.find((call) => call.route === documentPrepare.name)!
    .input as Record<string, unknown>;
  // 기존 문서는 그 문서 id와 기준 판으로 준비하고 metadata·format을 새로 정하지 않는다.
  assertEquals(prepare.document, document);
  assertEquals(prepare.base_version, VER1);
  assert(!("metadata" in prepare));
  assert(!("format" in prepare));
  const sent = calls.find((call) => call.route === documentSave.name)!;
  assertEquals(sent.extra, {
    key: "report-2",
    compare: { base_version: VER1 },
  });
});

Deno.test("documents/versions#R14: 첫 저장의 재전송은 같은 문서로 저장 결과를 다시 받고 다른 key의 기준 없는 저장은 conflict다", async () => {
  const minted = await appDocumentId(APP, "weekly-report", "report-1");
  // 응답을 잃은 첫 저장의 재전송: 이미 있는 문서가 이 재전송 key의 문서다.
  const retry = world({
    existing: { id: minted, name: "weekly-report", latest: VER1 },
  });
  const again = await retry.adapter.save(request());
  assert(again.ok);
  const prepare = retry.calls.find((call) =>
    call.route === documentPrepare.name
  )!
    .input as Record<string, unknown>;
  assertEquals(prepare.document, minted);
  assertEquals(prepare.base_version, null);
  // 다른 key로 이미 있는 문서에 기준 판 없이 쓰는 것은 기존 판을 덮을 수 있어 거절한다.
  const other = world({
    existing: {
      id: "doc_01arz3ndektsv4rrffq69g5fb0",
      name: "weekly-report",
      latest: VER1,
    },
  });
  const rejected = fail(await other.adapter.save(request()));
  assertEquals(rejected.code, "conflict");
  assertEquals(
    other.calls.filter((call) => call.kind !== "read").length,
    0,
  );
  // 기준 판을 줬는데 그 이름의 문서가 없다.
  const missing = fail(
    await world().adapter.save(request({ baseVersion: VER1 })),
  );
  assertEquals(missing.code, "conflict");
});

Deno.test("documents/versions#R14: 새 문서 id는 앱마다 다르다(다른 앱의 같은 재전송 key와 겹치지 않는다)", async () => {
  const one = await appDocumentId(APP, "weekly-report", "report-1");
  const two = await appDocumentId(
    "app_01arz3ndektsv4rrffq69g5faw",
    "weekly-report",
    "report-1",
  );
  const three = await appDocumentId(APP, "weekly-report", "report-1");
  assert(one !== two);
  assertEquals(one, three);
  assert(/^doc_[0-9a-hjkmnp-tv-z]{26}$/.test(one));
});

Deno.test("documents/versions#R14: 미선언·문서 이름이 아닌 key·파일 없는 출력은 core에 아무것도 보내지 않고 거절한다", async () => {
  const undeclared = world({ declared: false });
  assertEquals(
    fail(await undeclared.adapter.save(request())).code,
    "invalid_input",
  );
  assertEquals(undeclared.calls.length, 0);
  const badKey = world();
  assertEquals(
    fail(await badKey.adapter.save(request({ key: "Weekly Report" }))).code,
    "invalid_input",
  );
  assertEquals(badKey.calls.length, 0);
  const empty = world({ files: [] });
  assertEquals(fail(await empty.adapter.save(request())).code, "not_found");
  assertEquals(empty.calls.length, 0);
});

Deno.test("documents/versions#R14: 올린 blob의 hash가 읽은 값과 다르면 파일이 읽는 사이 바뀐 것이라 저장하지 않는다", async () => {
  const { adapter, calls } = world({ uploadHash: "cd".repeat(32) });
  const rejected = fail(await adapter.save(request()));
  assertEquals(rejected.code, "conflict");
  assert(!calls.some((call) => call.route === documentPrepare.name));
  assert(!calls.some((call) => call.route === documentSave.name));
});

Deno.test("documents/versions#R14: 준비 거절(명시 format 부적합 등)은 저장을 시작하지 않고 그 오류 그대로다", async () => {
  const { adapter, calls } = world({
    prepareFails: { code: "invalid_input", message: "format error" },
  });
  const rejected = fail(await adapter.save(request()));
  assertEquals(rejected, { code: "invalid_input", message: "format error" });
  assert(!calls.some((call) => call.route === documentSave.name));
});

Deno.test("documents/versions#R14: 같은 내용이라 새 판이 없으면 saved=false에 지금 최신 판을 돌려준다", async () => {
  const document = await appDocumentId(APP, "weekly-report", "report-1");
  const { adapter } = world({
    existing: { id: document, name: "weekly-report", latest: VER1 },
    saveStatus: "unchanged",
  });
  const saved = await adapter.save(
    request({ baseVersion: VER1, idempotencyKey: "report-2" }),
  );
  assert(saved.ok);
  assertEquals(saved.value, { saved: false, version: VER2 });
});

Deno.test("documents/versions#R14: app credential을 받지 못하면 unavailable이고 출력은 올라가지 않는다", async () => {
  const adapter = createAppDocumentsSave({
    client: () =>
      Promise.resolve(
        err({ code: "unavailable", message: "no credential" } as LophnError),
      ),
    output: { files: () => Promise.resolve(ok([outputFile()])) },
    declarations: {
      get: () => Promise.resolve(ok({ name: "주간 보고", format: FORMAT })),
    },
  });
  assertEquals(fail(await adapter.save(request())).code, "unavailable");
});
