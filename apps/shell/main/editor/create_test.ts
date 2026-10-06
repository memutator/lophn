// 새 문서 첫 판의 main 통로(shell#T17, flow write-series 2·5). core 통로를 주입해 업로드·준비·저장에
// 무엇을 싣고 결과(첫 판, 충돌, 실패, 응답 유실)를 어떻게 돌려주는지 본다. 실제 core 위의 같은
// 흐름(가족 가입과 draft 비움)은 renderer/editor/draft-document-real-core_test.ts가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createDocumentCreator, type CreatePort } from "./create.ts";
import { type PortError, sha256 } from "./file-adapter.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const V1 = "ver_01kq12a1pha000000000000001";
const PROJECT = "prj_01kq12a1pha000000000000000";
const BYTES = new TextEncoder().encode("# P003\n\nthird\n");
const INPUT = {
  document: DOC,
  request_key: "member-0000000000000001",
  title: "P003",
  place: { kind: "project" as const, id: PROJECT },
  name: "p003",
  bytes: BYTES,
};

function fakePort(
  save: () => { ok: true; value: { version: string } } | {
    ok: false;
    error: PortError;
  },
  latest: PortError | null = null,
) {
  const calls: { name: string; input: unknown }[] = [];
  const port: CreatePort = {
    upload: (bytes, hash) => {
      calls.push({ name: "upload", input: { size: bytes.byteLength, hash } });
      return Promise.resolve({
        ok: true,
        value: {
          preparation: "prep_1",
          principal: "user",
          purpose: "document_file",
          hash,
          size_bytes: bytes.byteLength,
        },
      });
    },
    prepare: (input) => {
      calls.push({ name: "prepare", input });
      return Promise.resolve({
        ok: true,
        value: {
          preparation_ref: "pv_1",
          idempotency_key: INPUT.request_key,
          document: DOC,
        },
      });
    },
    save: (request) => {
      calls.push({ name: "save", input: request });
      return Promise.resolve(save());
    },
    latest: (document) => {
      calls.push({ name: "latest", input: document });
      return Promise.resolve(
        latest === null
          ? { ok: true, value: { version: V1 } }
          : { ok: false, error: latest },
      );
    },
  };
  return { port, calls };
}

test("shell/editor#R12 documents/series#R2: 새 문서의 첫 판은 바이트를 올리고 base_version 없이 준비해 그 준비로 저장한다", async () => {
  const { port, calls } = fakePort(() => ({
    ok: true,
    value: { version: V1 },
  }));
  const creator = createDocumentCreator({ port: () => port });
  const reply = await creator.create(INPUT);
  assert.deepEqual(reply, {
    ok: true,
    value: { outcome: "saved", version: V1, failure: null },
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "upload",
    "prepare",
    "save",
  ]);
  assert.deepEqual(calls[0]!.input, {
    size: BYTES.byteLength,
    hash: sha256(BYTES),
  });
  const prepared = calls[1]!.input as Record<string, unknown>;
  assert.equal(prepared["document"], DOC);
  assert.equal(prepared["base_version"], null);
  assert.equal(prepared["source"], null);
  // 형식은 생략한다(그 MIME의 기본 형식). 자리·이름은 가족의 것이다.
  assert.equal("format" in prepared, false);
  assert.deepEqual(prepared["metadata"], {
    title: "P003",
    place: { kind: "project", id: PROJECT },
    name: "p003",
  });
  const file = (prepared["files"] as Record<string, unknown>[])[0]!;
  assert.equal(file["path"], "p003.md");
  assert.equal(file["media_type"], "text/markdown");
  assert.equal(file["blob_hash"], sha256(BYTES));
  assert.equal(file["primary"], true);
  assert.deepEqual(calls[2]!.input, {
    input: {
      preparation_ref: "pv_1",
      idempotency_key: INPUT.request_key,
      document: DOC,
    },
    idempotency_key: INPUT.request_key,
    compare: { base_version: null },
    prepared: ["pv_1"],
  });
});

test("shell/editor#R2 documents/series#R2: 그 사이 key·가족이 바뀐 저장은 충돌이고 다른 거절은 이유와 함께 저장하지 않음이다", async () => {
  const conflict = fakePort(() => ({
    ok: false,
    error: { code: "conflict", message: "key is already taken" },
  }));
  assert.deepEqual(
    await createDocumentCreator({ port: () => conflict.port }).create(INPUT),
    { ok: true, value: { outcome: "conflict", version: null, failure: null } },
  );
  const forbidden = fakePort(() => ({
    ok: false,
    error: { code: "unauthorized", message: "token" },
  }));
  assert.deepEqual(
    await createDocumentCreator({ port: () => forbidden.port }).create(INPUT),
    {
      ok: true,
      value: { outcome: "failed", version: null, failure: "forbidden" },
    },
  );
  // 연결된 core가 없으면 아무것도 보내지 않는다.
  assert.deepEqual(
    await createDocumentCreator({ port: () => null }).create(INPUT),
    {
      ok: true,
      value: { outcome: "failed", version: null, failure: "offline" },
    },
  );
});

test("shell/editor#R2: 응답을 잃은 저장은 다시 저장하지 않고 그 예정 문서를 조회해 결과를 정한다", async () => {
  const lost = { code: "unavailable", details: { reason: "transport_failed" } };
  const found = fakePort(() => ({
    ok: false,
    error: { ...lost, message: "lost" },
  }));
  assert.deepEqual(
    await createDocumentCreator({ port: () => found.port }).create(INPUT),
    { ok: true, value: { outcome: "saved", version: V1, failure: null } },
  );
  assert.deepEqual(found.calls.map((call) => call.name), [
    "upload",
    "prepare",
    "save",
    "latest",
  ]);
  const absent = fakePort(
    () => ({ ok: false, error: { ...lost, message: "lost" } }),
    { code: "not_found", message: "no document" },
  );
  assert.deepEqual(
    await createDocumentCreator({ port: () => absent.port }).create(INPUT),
    {
      ok: true,
      value: { outcome: "unknown", version: null, failure: "unknown" },
    },
  );
  assert.equal(
    absent.calls.filter((call) => call.name === "save").length,
    1,
  );
});
