import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalFilesHash,
  createFileAdapter,
  type DocumentRead,
  type FileOperationResult,
  type FilesPort,
  type PortResult,
  sha256,
  type ValidateInput,
  type WriteRequest,
} from "./file-adapter.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const BASE_VERSION = "ver_01kq12a1pha000000000000001";
const SAVED_VERSION = "ver_01kq12a1pha000000000000002";
const LATEST_VERSION = "ver_01kq12a1pha000000000000003";
const PROJECT = "prj_01kq12a1pha000000000000000";
const PATH = "/home/someone/notes/plan.md";
const encoder = new TextEncoder();
const ORIGINAL = encoder.encode("# Plan\n");

function documentRead(
  source: DocumentRead["document"]["file_source"],
): DocumentRead {
  return {
    document: { id: DOC, latest_version: BASE_VERSION, file_source: source },
    version: {
      id: BASE_VERSION,
      files: [{ path: "plan.md", primary: true, media_type: "text/markdown" }],
      format: {
        name: "document",
        module_hash: "cd".repeat(32),
        explicit: false,
      },
    },
  };
}

function written(
  request: WriteRequest,
  over: Partial<FileOperationResult> = {},
): FileOperationResult {
  return {
    outcome: "written",
    written_hash: request.content.blob.hash,
    observed_hash: request.content.blob.hash,
    observed_at: "2026-10-06T00:00:00.000Z",
    changed_again: false,
    recording: "recorded",
    version_result: request.version_request ? "preparing" : "not_requested",
    ...over,
  };
}

interface Fake {
  port: FilesPort;
  writes: WriteRequest[];
  uploads: number;
  validations: ValidateInput[];
}

function fake(over: {
  source?: DocumentRead["document"]["file_source"];
  read?: PortResult<Uint8Array>;
  versionFile?: PortResult<Uint8Array>;
  upload?: PortResult<never>;
  write?: (request: WriteRequest) => PortResult<FileOperationResult>;
  diagnostics?: {
    severity: "error" | "warning";
    message: string;
    file: string | null;
    start_line: number | null;
  }[];
} = {}): Fake {
  const state: Fake = {
    writes: [],
    uploads: 0,
    validations: [],
    port: undefined as unknown as FilesPort,
  };
  state.port = {
    document: () =>
      Promise.resolve({
        ok: true,
        value: documentRead(
          "source" in over
            ? over.source!
            : { kind: "project_file", project: PROJECT, path: PATH },
        ),
      }),
    read: () => Promise.resolve(over.read ?? { ok: true, value: ORIGINAL }),
    versionFile: () =>
      Promise.resolve(over.versionFile ?? { ok: true, value: ORIGINAL }),
    watch: () =>
      Promise.resolve({
        ok: true,
        value: {
          status: {
            state: "tracked",
            observed_at: "2026-10-06T00:00:00.000Z",
            observed_hash: sha256(ORIGINAL),
            compared_version: BASE_VERSION,
          },
          next_cursor: "c1",
        },
      }),
    upload: (bytes, hash) => {
      state.uploads += 1;
      if (over.upload) return Promise.resolve(over.upload);
      return Promise.resolve({
        ok: true,
        value: {
          preparation: `prep-${state.uploads}`,
          principal: "user",
          purpose: "document_file",
          hash,
          size_bytes: bytes.byteLength,
        },
      });
    },
    write: (request) => {
      state.writes.push(request);
      return Promise.resolve(
        over.write
          ? over.write(request)
          : { ok: true, value: written(request) },
      );
    },
    validate: (input) => {
      state.validations.push(input);
      const diagnostics = over.diagnostics ?? [];
      return Promise.resolve({
        ok: true,
        value: {
          status: diagnostics.some((item) => item.severity === "error")
            ? "failed"
            : "passed",
          diagnostics,
          complete: true,
          next_cursor: null,
        },
      });
    },
  };
  return state;
}

function adapterOf(state: Fake) {
  let n = 0;
  return createFileAdapter({
    port: () => state.port,
    newHandle: () => `es_handle${++n}xx`,
    log: () => {},
  });
}

async function openOne(state: Fake) {
  const adapter = adapterOf(state);
  const opened = await adapter.open(7, DOC);
  assert.ok(opened.ok);
  return { adapter, opened: opened.value };
}

function writeInput(
  session: string,
  text: string,
  base: string | null,
  end = false,
  key = "key-0000000000000001",
) {
  return {
    session,
    request_key: key,
    base_hash: base,
    bytes: encoder.encode(text),
    end,
  };
}

test("shell/editor#R12: 열기는 문서 id로 원본 목표를 main에서 풀고 renderer에는 handle·글·base_hash만 준다", async () => {
  const state = fake();
  const { opened } = await openOne(state);
  assert.deepEqual(opened, {
    session: "es_handle1xx",
    text: "# Plan\n",
    base_hash: sha256(ORIGINAL),
    target: "project_file",
    primary_path: "plan.md",
  });
  assert.equal(JSON.stringify(opened).includes(PATH), false);
});

test("shell/editor#R12: 원본 없는 문서는 working copy를 목표로 하고 아직 없으면 연 판의 주 파일로 시작한다", async () => {
  const state = fake({
    source: null,
    read: { ok: false, error: { code: "not_found", message: "missing" } },
  });
  const { adapter, opened } = await openOne(state);
  assert.equal(opened.target, "working_copy");
  assert.equal(opened.text, "# Plan\n");
  // 첫 쓰기가 working copy를 만든다.
  assert.equal(opened.base_hash, null);
  await adapter.write(7, writeInput(opened.session, "# Plan\nmore\n", null));
  assert.deepEqual(state.writes[0]!.target, {
    kind: "working_copy",
    document: DOC,
  });
  assert.equal(state.writes[0]!.base_hash, null);
});

test("shell/editor#R12: 저장 버튼 없는 고침은 바이트를 올리고 target·base_hash·request_key로 파일만 쓴다", async () => {
  const state = fake();
  const { adapter, opened } = await openOne(state);
  const reply = await adapter.write(
    7,
    writeInput(opened.session, "# Plan\nnext\n", opened.base_hash),
  );
  assert.ok(reply.ok);
  assert.equal(state.uploads, 1);
  const request = state.writes[0]!;
  assert.deepEqual(request.target, {
    kind: "project_file",
    project: PROJECT,
    path: PATH,
  });
  assert.equal(request.request_key, "key-0000000000000001");
  assert.equal(request.base_hash, sha256(ORIGINAL));
  assert.equal(
    request.content.blob.hash,
    sha256(encoder.encode("# Plan\nnext\n")),
  );
  // 자동 저장은 version 준비를 싣지 않는다.
  assert.equal(request.version_request, undefined);
  assert.equal(reply.value.disk, "written");
  assert.equal(reply.value.version, null);
  assert.equal(state.validations.length, 0);
});

test("shell/editor#R1 shell/editor#R2: 편집 종료 쓰기만 version 준비를 싣고, 판 확정·형식 검사 실패가 파일 저장 성공을 지우지 않는다", async () => {
  const state = fake({
    source: null,
    write: (request) => ({
      ok: true,
      value: written(request, { version_result: "validation_failed" }),
    }),
    diagnostics: [{
      severity: "error",
      message: "heading",
      file: "plan.md",
      start_line: 1,
    }],
  });
  const { adapter, opened } = await openOne(state);
  const reply = await adapter.write(
    7,
    writeInput(opened.session, "bad\n", opened.base_hash, true),
  );
  assert.ok(reply.ok);
  assert.deepEqual(state.writes[0]!.version_request, {
    document: DOC,
    base_version: BASE_VERSION,
    idempotency_key: "key-0000000000000001-v",
  });
  assert.equal(reply.value.disk, "written");
  assert.equal(reply.value.recording, "recorded");
  assert.equal(reply.value.version, "validation_failed");
  assert.deepEqual(reply.value.problems, [{
    severity: "error",
    message: "heading",
    file: "plan.md",
    start_line: 1,
  }]);
  // 형식 검사는 쓴 그 준비 blob과 canonical 파일 hash로 돈다.
  const input = state.validations[0]!;
  assert.equal(input.files[0]!.blob_hash, sha256(encoder.encode("bad\n")));
  assert.equal(
    input.input_hash,
    canonicalFilesHash([{
      blob_hash: sha256(encoder.encode("bad\n")),
      bytes: 4,
      media_type: "text/markdown",
      path: "plan.md",
      primary: true,
    }]),
  );
});

test("shell/editor#R2: 판이 확정되면 다음 편집 종료의 기준 판이 그 판이 되고, version 충돌은 최신 판을 함께 돌려준다", async () => {
  let round = 0;
  const state = fake({
    source: null,
    write: (request) => {
      round += 1;
      return {
        ok: true,
        value: round === 1
          ? written(request, {
            version_result: "confirmed",
            save_result: { version: SAVED_VERSION },
          })
          : written(request, {
            version_result: "conflict",
            latest_version: LATEST_VERSION,
          }),
      };
    },
  });
  const { adapter, opened } = await openOne(state);
  const first = await adapter.write(
    7,
    writeInput(opened.session, "a\n", null, true, "key-0000000000000001"),
  );
  assert.ok(first.ok);
  assert.equal(first.value.saved_version, SAVED_VERSION);
  const second = await adapter.write(
    7,
    writeInput(
      opened.session,
      "b\n",
      first.value.written_hash,
      true,
      "key-0000000000000002",
    ),
  );
  assert.ok(second.ok);
  assert.equal(state.writes[1]!.version_request!.base_version, SAVED_VERSION);
  assert.equal(second.value.disk, "written");
  assert.equal(second.value.version, "conflict");
  assert.equal(second.value.latest_version, LATEST_VERSION);
  // 사람이 최신 판을 새 기준으로 고르면 그 판으로 다시 확정한다.
  await adapter.write(7, {
    ...writeInput(
      opened.session,
      "b\n",
      second.value.written_hash,
      true,
      "key-0000000000000003",
    ),
    base_version: LATEST_VERSION,
  });
  assert.equal(state.writes[2]!.version_request!.base_version, LATEST_VERSION);
});

test("shell/editor#R15: base_hash가 낡으면 conflict이고 파일은 documents가 그대로 둔다", async () => {
  const state = fake({
    write: () => ({
      ok: false,
      error: { code: "conflict", message: "changed" },
    }),
  });
  const { adapter, opened } = await openOne(state);
  const reply = await adapter.write(
    7,
    writeInput(opened.session, "x\n", opened.base_hash),
  );
  assert.ok(reply.ok);
  assert.equal(reply.value.disk, "conflict");
  assert.equal(reply.value.written_hash, null);
});

test("shell/editor#R12: 결과를 모르는 쓰기는 다시 쓰지 않고 documents 상태로 그 바이트가 있는지 본다", async () => {
  const state = fake({
    write: () => ({
      ok: false,
      error: {
        code: "unavailable",
        message: "transport failed",
        details: { reason: "transport_failed" },
      },
    }),
  });
  // 결과 조회는 지금 디스크 바이트를 읽어 hash를 본다.
  let disk = ORIGINAL;
  state.port.read = () => Promise.resolve({ ok: true, value: disk });
  const { adapter, opened } = await openOne(state);
  const reply = await adapter.write(
    7,
    writeInput(opened.session, "y\n", opened.base_hash),
  );
  assert.ok(reply.ok);
  assert.equal(reply.value.disk, "unknown");
  // 아직 쓰기 전 그대로다.
  const before = await adapter.lookup(7, {
    session: opened.session,
    request_key: "key-0000000000000001",
  });
  assert.ok(before.ok);
  assert.equal(before.value.state, "not_written");
  assert.equal(before.value.observed_hash, sha256(ORIGINAL));
  // 다른 key로 다시 모르는 쓰기를 만들고, 이번에는 그 바이트가 디스크에 있다.
  await adapter.write(
    7,
    writeInput(
      opened.session,
      "z\n",
      opened.base_hash,
      false,
      "key-0000000000000002",
    ),
  );
  disk = encoder.encode("z\n");
  const after = await adapter.lookup(7, {
    session: opened.session,
    request_key: "key-0000000000000002",
  });
  assert.ok(after.ok);
  assert.equal(after.value.state, "written");
  // 조회는 쓰기를 다시 보내지 않는다.
  assert.equal(state.writes.length, 2);
});

test("shell/editor#R12: 업로드가 실패하면 파일 쓰기 요청을 보내지 않고 실패로 답한다", async () => {
  const state = fake({
    upload: { ok: false, error: { code: "unavailable", message: "disk" } },
  });
  const { adapter, opened } = await openOne(state);
  const reply = await adapter.write(
    7,
    writeInput(opened.session, "q\n", opened.base_hash),
  );
  assert.ok(reply.ok);
  assert.equal(reply.value.disk, "failed");
  assert.equal(state.writes.length, 0);
});

test("shell/editor#R12: 다른 창은 handle을 쓰지 못하고 core가 없으면 offline이다", async () => {
  const state = fake();
  const { adapter, opened } = await openOne(state);
  assert.deepEqual(
    await adapter.write(8, writeInput(opened.session, "x", opened.base_hash)),
    { ok: false, code: "unknown_session" },
  );
  adapter.dropOwner(7);
  assert.deepEqual(
    await adapter.current(7, { session: opened.session }),
    { ok: false, code: "unknown_session" },
  );
  const offline = createFileAdapter({ port: () => null, log: () => {} });
  assert.deepEqual(await offline.open(7, DOC), { ok: false, code: "offline" });
});

test("shell/editor#R12: UTF-8이 아닌 파일과 상한을 넘는 파일은 편집으로 열지 않는다", async () => {
  const binary = fake({
    read: { ok: true, value: new Uint8Array([0xff, 0xfe, 0x00]) },
  });
  assert.deepEqual(await adapterOf(binary).open(7, DOC), {
    ok: false,
    code: "unsupported",
  });
  const large = fake({
    read: { ok: false, error: { code: "too_large", message: "big" } },
  });
  assert.deepEqual(await adapterOf(large).open(7, DOC), {
    ok: false,
    code: "too_large",
  });
});
