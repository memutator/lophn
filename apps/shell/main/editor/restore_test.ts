// 버전 복원의 main 통로(shell#T18). core 통로를 주입해 준비·복원 명령·파일 쓰기에 무엇을 싣고
// 결과(새 판, 같아서 변경 없음, 충돌, 파일 단계)를 어떻게 돌려주는지 본다. 실제 core 위의 같은
// 흐름은 renderer/editor/versions/versions-real-core_test.ts가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { type PortError, sha256, type WriteRequest } from "./file-adapter.ts";
import { createRestorer, type FixedRead, type RestorePort } from "./restore.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const V1 = "ver_01kq12a1pha000000000000001";
const V2 = "ver_01kq12a1pha000000000000002";
const V3 = "ver_01kq12a1pha000000000000003";
const PROJECT = "prj_01kq12a1pha000000000000000";
const PATH = "/home/someone/notes/plan.md";
const encoder = new TextEncoder();
const OLD = encoder.encode("# Plan\nfirst\n");
const NOW = encoder.encode("# Plan\nsecond\n");
const FORMAT = {
  name: "document",
  module_hash: "cd".repeat(32),
  explicit: true,
};

function fixed(
  version: string,
  bytes: Uint8Array,
  latest: string,
  linked: boolean,
): FixedRead {
  return {
    document: {
      id: DOC,
      latest_version: latest,
      revision: "7",
      status: "active",
      file_source: linked
        ? { kind: "project_file", project: PROJECT, path: PATH }
        : null,
    },
    version: {
      id: version,
      number: Number(version.at(-1)),
      content_hash: `content-${sha256(bytes)}`,
      files: [{
        path: "plan.md",
        blob_hash: sha256(bytes),
        bytes: bytes.byteLength,
        media_type: "text/markdown",
        primary: true,
      }],
      format: FORMAT,
    },
  };
}

interface Fake {
  port: RestorePort;
  prepared: Record<string, unknown>[];
  restores: Record<string, unknown>[];
  writes: WriteRequest[];
}

function fake(over: {
  linked?: boolean;
  disk?: Uint8Array;
  restore?: (
    count: number,
  ) =>
    | { ok: true; value: { status: "saved" | "unchanged"; version: string } }
    | { ok: false; error: PortError };
  write?:
    | Partial<{ observed_hash: string; changed_again: boolean }>
    | PortError;
  latestAfterConflict?: FixedRead;
} = {}): Fake {
  const linked = over.linked ?? false;
  let latest = fixed(V2, NOW, V2, linked);
  const state: Fake = {
    prepared: [],
    restores: [],
    writes: [],
    port: undefined as unknown as RestorePort,
  };
  state.port = {
    fixed: (_document, version) => {
      if (version === V1) {
        return Promise.resolve({
          ok: true,
          value: fixed(V1, OLD, latest.document.latest_version, linked),
        });
      }
      return Promise.resolve({ ok: true, value: latest });
    },
    project: () => Promise.resolve({ ok: true, value: { revision: "4" } }),
    read: () => Promise.resolve({ ok: true, value: over.disk ?? NOW }),
    versionFile: () => Promise.resolve({ ok: true, value: OLD }),
    watch: () => Promise.reject(new Error("not used")),
    upload: (bytes, hash) =>
      Promise.resolve({
        ok: true,
        value: {
          preparation: "prep-1",
          principal: "user",
          purpose: "document_file",
          hash,
          size_bytes: bytes.byteLength,
        },
      }),
    write: (request) => {
      state.writes.push(request);
      const shape = over.write;
      if (shape && "code" in shape) {
        return Promise.resolve({ ok: false, error: shape as PortError });
      }
      return Promise.resolve({
        ok: true,
        value: {
          outcome: "written",
          written_hash: request.content.blob.hash,
          observed_hash: shape?.observed_hash ?? request.content.blob.hash,
          observed_at: "2026-10-06T00:00:01.000Z",
          changed_again: shape?.changed_again ?? false,
          recording: "recorded",
          version_result: "not_requested",
        },
      });
    },
    prepare: (input) => {
      const value = input as Record<string, unknown>;
      state.prepared.push(value);
      return Promise.resolve({
        ok: true,
        value: {
          preparation_ref: `prepared-${state.prepared.length}`,
          idempotency_key: value.idempotency_key as string,
        },
      });
    },
    restore: (request) => {
      state.restores.push(request as Record<string, unknown>);
      const answer = over.restore?.(state.restores.length) ??
        { ok: true as const, value: { status: "saved" as const, version: V3 } };
      if (
        !answer.ok && answer.error.code === "conflict" &&
        over.latestAfterConflict
      ) {
        latest = over.latestAfterConflict;
      }
      return Promise.resolve(answer);
    },
  };
  return state;
}

const KEY = "restore-0123456789abcdef";

test("shell/editor#R14: 원본이 없는 문서는 고른 판의 원문 blob 참조와 정확한 FormatRef로 준비하고 최신 판·revision CAS로 복원한다", async () => {
  const state = fake();
  const restorer = createRestorer({ port: () => state.port, log: () => {} });
  const reply = await restorer.restore({
    document: DOC,
    version: V1,
    base_version: V2,
    request_key: KEY,
  });
  assert.deepEqual(reply, {
    ok: true,
    value: { outcome: "saved", version: V3, file: null, failure: null },
  });
  assert.equal(state.writes.length, 0);
  const prepared = state.prepared[0]!;
  assert.equal(prepared.base_version, V2);
  assert.deepEqual(prepared.format, FORMAT);
  assert.equal(prepared.source, null);
  assert.equal("file_basis" in prepared, false);
  const files = prepared.files as {
    content: { kind: string; reference: { owner_key: string; hash: string } };
  }[];
  assert.equal(files[0]!.content.kind, "existing");
  assert.equal(files[0]!.content.reference.owner_key, `${V1}/plan.md`);
  assert.equal(files[0]!.content.reference.hash, sha256(OLD));
  const request = state.restores[0]!;
  assert.deepEqual(request.compare, { base_version: V2, base_revision: "7" });
  assert.deepEqual(request.prepared, ["prepared-1"]);
  assert.equal(request.idempotency_key, KEY);
  assert.equal(
    (request.input as { restore_version: string }).restore_version,
    V1,
  );
});

test("shell/editor#R14: 최신 판과 같은 내용이면 unchanged를, 그 사이 판이 바뀌면 conflict를 그대로 돌려준다", async () => {
  const same = fake({
    restore: () => ({ ok: true, value: { status: "unchanged", version: V2 } }),
  });
  const restorer = createRestorer({ port: () => same.port, log: () => {} });
  const unchanged = await restorer.restore({
    document: DOC,
    version: V1,
    base_version: V2,
    request_key: KEY,
  });
  assert.deepEqual(unchanged, {
    ok: true,
    value: { outcome: "unchanged", version: V2, file: null, failure: null },
  });
  const moved = fake({
    restore: () => ({
      ok: false,
      error: { code: "conflict", message: "latest version changed" },
    }),
  });
  const conflict = await createRestorer({
    port: () => moved.port,
    log: () => {},
  })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(conflict, {
    ok: true,
    value: { outcome: "conflict", version: null, file: null, failure: null },
  });
  // 원본이 없는 문서의 충돌은 다시 묻지 않는다. 사람이 다시 비교한다.
  assert.equal(moved.restores.length, 1);
});

test("shell/editor#R14: 원본 연결 문서는 고른 판 바이트를 지금 디스크 hash로 CAS해 쓰고 그 관측을 근거로 복원한다", async () => {
  const state = fake({ linked: true });
  const restorer = createRestorer({ port: () => state.port, log: () => {} });
  const reply = await restorer.restore({
    document: DOC,
    version: V1,
    base_version: V2,
    request_key: KEY,
  });
  assert.deepEqual(reply, {
    ok: true,
    value: { outcome: "saved", version: V3, file: "written", failure: null },
  });
  const write = state.writes[0]!;
  assert.equal(write.base_hash, sha256(NOW));
  assert.equal(write.content.blob.hash, sha256(OLD));
  assert.deepEqual(write.target, {
    kind: "project_file",
    project: PROJECT,
    path: PATH,
  });
  assert.equal("version_request" in write, false);
  const prepared = state.prepared[0]!;
  assert.deepEqual(prepared.source, {
    kind: "file",
    project: PROJECT,
    path: PATH,
    original_hash: sha256(OLD),
    observed_at: "2026-10-06T00:00:01.000Z",
  });
  assert.deepEqual(prepared.file_basis, {
    kind: "project_file",
    project: PROJECT,
    path: PATH,
    document_revision: "7",
    document_status: "active",
    original_hash: sha256(OLD),
    observed_at: "2026-10-06T00:00:01.000Z",
    project_revision: "4",
    file_source: { kind: "project_file", project: PROJECT, path: PATH },
  });
});

test("shell/editor#R14: 바깥에서 파일이 바뀌어 쓰기가 막히면 파일 충돌로 멈추고 판을 만들지 않는다", async () => {
  const state = fake({
    linked: true,
    write: { code: "conflict", message: "changed" },
  });
  const reply = await createRestorer({ port: () => state.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(reply, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      file: "conflict",
      failure: null,
    },
  });
  assert.equal(state.prepared.length, 0);
  // 쓴 뒤 그 사이 또 바뀌었으면 낡은 관측으로 확정하지 않는다.
  const again = fake({ linked: true, write: { changed_again: true } });
  const moved = await createRestorer({ port: () => again.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(moved, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      file: "written",
      failure: null,
    },
  });
  assert.equal(again.restores.length, 0);
});

test("shell/editor#R14: 관측이 같은 바이트로 판을 먼저 만들었으면 그 판이 복원 결과이고, 디스크와 최신 판이 이미 같으면 쓰지 않는다", async () => {
  const observed = fixed(V3, OLD, V3, true);
  const raced = fake({
    linked: true,
    restore: () => ({
      ok: false,
      error: { code: "conflict", message: "latest version changed" },
    }),
    latestAfterConflict: observed,
  });
  const reply = await createRestorer({ port: () => raced.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(reply, {
    ok: true,
    value: { outcome: "saved", version: V3, file: "written", failure: null },
  });
  const done = fake({ linked: true, disk: OLD });
  // 최신 판이 이미 고른 판의 내용이다.
  const latest = fixed(V3, OLD, V3, true);
  done.port.fixed = (_document, version) =>
    Promise.resolve({
      ok: true,
      value: version === V1 ? fixed(V1, OLD, V3, true) : latest,
    });
  const same = await createRestorer({ port: () => done.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V3,
      request_key: KEY,
    });
  assert.deepEqual(same, {
    ok: true,
    value: { outcome: "unchanged", version: V3, file: "same", failure: null },
  });
  assert.equal(done.writes.length, 0);
});

test("shell/editor#R14: 경로별 원문 행이 없는 옛 판과 연결이 없는 core는 복원하지 않는다", async () => {
  const state = fake();
  const blob = fixed(V1, OLD, V2, false);
  state.port.fixed = (_document, version) =>
    Promise.resolve({
      ok: true,
      value: version === V1
        ? {
          ...blob,
          version: { ...blob.version, files: { hash: "ab".repeat(32) } },
        }
        : fixed(V2, NOW, V2, false),
    });
  const restorer = createRestorer({ port: () => state.port, log: () => {} });
  assert.deepEqual(
    await restorer.restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    }),
    { ok: false, code: "unsupported" },
  );
  const offline = createRestorer({ port: () => null, log: () => {} });
  assert.deepEqual(
    await offline.restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    }),
    { ok: false, code: "offline" },
  );
});

test("shell/editor#R15 documents/file-tracking#R11: 비교로 본 판 뒤에 바깥이 파일을 고쳤고 관측이 아직 판을 만들지 않았으면 쓰지 않고 파일 충돌로 멈춘다", async () => {
  const outside = encoder.encode("# Plan\noutside edit\n");
  const state = fake({ linked: true, disk: outside });
  const reply = await createRestorer({ port: () => state.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(reply, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      file: "conflict",
      failure: null,
    },
  });
  // 바깥 내용은 덮이지 않았다: 쓰기도 준비도 복원 명령도 나가지 않았다.
  assert.equal(state.writes.length, 0);
  assert.equal(state.prepared.length, 0);
  assert.equal(state.restores.length, 0);
  // 바깥이 파일을 지웠어도 같다. 없는 파일을 되살린 판으로 새로 만들지 않는다.
  const gone = fake({ linked: true });
  gone.port.read = () =>
    Promise.resolve({
      ok: false,
      error: { code: "not_found", message: "missing" },
    });
  const deleted = await createRestorer({ port: () => gone.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(deleted, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      file: "conflict",
      failure: null,
    },
  });
  assert.equal(gone.writes.length, 0);
});

test("shell/editor#R15 documents/file-tracking#R11: 비교로 본 최신 판이 그 사이 바뀌었으면(관측이 바깥 변경을 판으로 만들었으면) 새 판 위에 쓰지 않고 충돌로 멈춘다", async () => {
  // 지금 최신 판은 V2인데 사람이 본 최신 판은 V1이라 낡은 기준이다.
  const linked = fake({ linked: true });
  const stale = await createRestorer({
    port: () => linked.port,
    log: () => {},
  })
    .restore({
      document: DOC,
      version: V3,
      base_version: V1,
      request_key: KEY,
    });
  assert.deepEqual(stale, {
    ok: true,
    value: { outcome: "conflict", version: null, file: null, failure: null },
  });
  assert.equal(linked.writes.length, 0);
  assert.equal(linked.prepared.length, 0);
  const plain = fake();
  const unlinked = await createRestorer({
    port: () => plain.port,
    log: () => {},
  })
    .restore({
      document: DOC,
      version: V1,
      base_version: V3,
      request_key: KEY,
    });
  assert.deepEqual(unlinked, {
    ok: true,
    value: { outcome: "conflict", version: null, file: null, failure: null },
  });
  assert.equal(plain.prepared.length, 0);
  assert.equal(plain.restores.length, 0);
});

test("shell/editor#R15 documents/file-tracking#R11: 쓰기 기준 hash는 비교로 본 판의 원문 hash이고 디스크가 이미 고른 바이트면 그 디스크 hash로 같은 바이트를 다시 쓴다", async () => {
  // 판 확정만 못 끝낸 앞 복원이 파일에 쓴 바이트가 남은 경우다. 덮을 바깥 내용이 없다.
  const state = fake({ linked: true, disk: OLD });
  const reply = await createRestorer({ port: () => state.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.equal(reply.ok && reply.value.outcome, "saved");
  assert.equal(state.writes[0]!.base_hash, sha256(OLD));
});

const LOST: PortError = {
  code: "unavailable",
  message: "transport failed",
  details: { reason: "transport_failed" },
};

test("shell/editor#R12 documents/file-tracking#R10 documents/file-tracking#R15: 파일을 쓴 뒤 연결이 끊기면 판 확정을 성공이나 확정 실패로 채우지 않는다", async () => {
  const state = fake({
    linked: true,
    restore: () => ({ ok: false, error: LOST }),
  });
  const reply = await createRestorer({ port: () => state.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.equal(state.writes.length, 1);
  assert.deepEqual(reply, {
    ok: true,
    value: {
      outcome: "failed",
      version: null,
      file: "written",
      failure: "offline",
    },
  });
  // 응답이 끊긴 것이 아니라 판 확정이 실패한 것은 그대로 확정 실패다.
  const refused = fake({
    linked: true,
    restore: () => ({
      ok: false,
      error: { code: "unavailable", message: "busy" },
    }),
  });
  const failed = await createRestorer({
    port: () => refused.port,
    log: () => {},
  }).restore({
    document: DOC,
    version: V1,
    base_version: V2,
    request_key: KEY,
  });
  assert.deepEqual(failed, {
    ok: true,
    value: {
      outcome: "pending",
      version: null,
      file: "written",
      failure: "unavailable",
    },
  });
});

test("shell/editor#R12 documents/file-tracking#R15: 복원을 시작하기도 전에 연결이 끊기면 저장된 판으로 답하지 않는다", async () => {
  const state = fake({ linked: true });
  state.port.fixed = () => Promise.resolve({ ok: false, error: LOST });
  const reply = await createRestorer({ port: () => state.port, log: () => {} })
    .restore({
      document: DOC,
      version: V1,
      base_version: V2,
      request_key: KEY,
    });
  assert.deepEqual(reply, { ok: false, code: "offline" });
  assert.equal(state.writes.length, 0);
  assert.equal(state.restores.length, 0);
});
