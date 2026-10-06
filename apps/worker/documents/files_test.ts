import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { FileOperationResult } from "../../../packages/contracts/documents/mod.ts";
import {
  createStatusRecorder,
  DOCUMENT_OPS,
  PREPARATION_OPS,
} from "../../../packages/documents/file-tracking/mod.ts";
import { createByteInbox } from "./byte-inbox.ts";
import { createFileHandlers, type FilesDeps, recordKeyOf } from "./files.ts";
import type { PoolRequest } from "./pool.ts";

const PROJECT = "prj_01kq12a1pha000000000000000";
const DOC = "doc_01kq12a1pha000000000000000";
const VERSION = "ver_01kq12a1pha000000000000001";
const HASH = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const DATA = "/data/lophn";

type Harness = {
  deps: FilesDeps;
  pooled: PoolRequest[];
  madeDirectories: string[];
  recorded: FileOperationResult[];
  sendBytes(channel: number, bytes: Uint8Array): void;
};

type Over = {
  pool?: (request: PoolRequest) => Result<unknown, LophnError>;
  record?: (
    result: FileOperationResult,
  ) => Promise<Result<FileOperationResult, LophnError>>;
  watchWaitMs?: number;
};

function harness(over: Over = {}): Harness {
  const pooled: PoolRequest[] = [];
  const madeDirectories: string[] = [];
  const recorded: FileOperationResult[] = [];
  const inbox = createByteInbox();
  const deps: FilesDeps = {
    dataRoot: DATA,
    basis: {
      roots: () => [{
        root: "/work/notes",
        project: PROJECT,
        project_revision: "3",
        patterns: [],
        use_gitignore: false,
      }],
    },
    pool: {
      request(request) {
        pooled.push(request);
        return Promise.resolve(
          over.pool?.(request) ?? ok({
            outcome: "written",
            beforePath: "/work/notes/a.md",
            afterPath: "/work/notes/a.md",
            beforeHash: HASH,
            writtenHash: OTHER,
            observedHash: OTHER,
            observedAt: "2026-10-06T00:00:00.000Z",
            changedAgain: false,
          }),
        );
      },
    },
    inbox,
    status: createStatusRecorder(),
    ops: {
      realPath: (path) => Promise.resolve(path),
      makeDirectory: (path) => {
        madeDirectories.push(path);
        return Promise.resolve();
      },
    },
    record: (result) => {
      recorded.push(result);
      return over.record?.(result) ?? Promise.resolve(ok({
        ...result,
        recording: "recorded" as const,
        event_seq: "11",
      }));
    },
    nowIso: () => "2026-10-06T00:00:00.000Z",
    watchWaitMs: over.watchWaitMs ?? 200,
    watchPollMs: 20,
  };
  return {
    deps,
    pooled,
    madeDirectories,
    recorded,
    sendBytes: (channel, bytes) =>
      inbox.collect({ kind: "bytes", channel, payload: bytes }),
  };
}

function writePayload(
  target: unknown,
  extra: Record<string, unknown> = {},
) {
  return {
    request: {
      request_key: "key-1",
      target,
      base_hash: HASH,
      content: {
        kind: "prepared",
        blob: {
          preparation: "p",
          principal: "person",
          purpose: "document_file",
          hash: OTHER,
          size_bytes: 3,
        },
      },
      ...extra,
    },
    content: { channel: 9, bytes: 3, hash: OTHER },
  };
}

const projectTarget = {
  kind: "project_file",
  project: PROJECT,
  path: "/work/notes/a.md",
};

Deno.test("documents/file-tracking#R11: project 파일 쓰기는 등록 폴더로 풀어 준비 worker 사람 slot에 맡기고 기록한다", async () => {
  const subject = harness();
  subject.sendBytes(9, new Uint8Array([1, 2, 3]));
  const handlers = createFileHandlers(subject.deps);
  const answered = await handlers.write(writePayload(projectTarget));
  assert(answered.ok);
  const done = answered.value as FileOperationResult;
  assertEquals(done.outcome, "written");
  assertEquals(done.recording, "recorded");
  assertEquals(done.event_seq, "11");
  assertEquals(done.version_result, "not_requested");
  assertEquals(subject.pooled.length, 1);
  const request = subject.pooled[0];
  assertEquals(request.op, PREPARATION_OPS.writeFile);
  assertEquals(request.priority, "human");
  assertEquals(request.keys, ["/work/notes/a.md"]);
  assertEquals(request.bytes, new Uint8Array([1, 2, 3]));
  const payload = typeof request.payload === "function"
    ? request.payload(77)
    : request.payload;
  assertEquals(payload, {
    location: { root: "/work/notes", path: "/work/notes/a.md" },
    base_hash: HASH,
    content: { channel: 77, bytes: 3, hash: OTHER },
  });
  assertEquals(subject.recorded.length, 1);
  assertEquals(
    await recordKeyOf(done),
    await recordKeyOf({ request_key: "key-1", operation: "write" }),
  );
});

Deno.test("documents/file-tracking#R15: 기록이 실패하거나 어긋나도 파일 저장 결과는 성공으로 남고 recording만 unverified다", async () => {
  for (
    const record of [
      () =>
        Promise.resolve(err({ code: "unavailable" as const, message: "x" })),
      () => Promise.reject(new Error("core is gone")),
      () =>
        Promise.resolve(
          ok({ not: "a result" } as unknown as FileOperationResult),
        ),
    ]
  ) {
    const subject = harness({ record });
    subject.sendBytes(9, new Uint8Array([1, 2, 3]));
    const answered = await createFileHandlers(subject.deps).write(
      writePayload(projectTarget),
    );
    assert(answered.ok);
    const done = answered.value as FileOperationResult;
    assertEquals(done.outcome, "written");
    assertEquals(done.recording, "unverified");
    assertEquals(done.event_seq, null);
  }
});

Deno.test("documents/file-tracking#R15: 결과 불명(unverified)은 기록하지 않는다", async () => {
  const subject = harness({
    pool: () =>
      ok({
        outcome: "unverified",
        beforePath: "/work/notes/a.md",
        afterPath: "/work/notes/a.md",
        beforeHash: HASH,
        writtenHash: OTHER,
        observedHash: null,
        observedAt: null,
        changedAgain: null,
      }),
  });
  subject.sendBytes(9, new Uint8Array([1, 2, 3]));
  const answered = await createFileHandlers(subject.deps).write(
    writePayload(projectTarget),
  );
  assert(answered.ok);
  assertEquals((answered.value as FileOperationResult).outcome, "unverified");
  assertEquals(subject.recorded, []);
});

Deno.test("documents/file-tracking#R2 documents/file-tracking#R1: 등록 폴더 밖·모르는 project·instruction 목표는 같은 invalid_input이고 준비 worker에 닿지 않는다", async () => {
  const subject = harness();
  const handlers = createFileHandlers(subject.deps);
  const messages = new Set<string>();
  const targets = [
    { ...projectTarget, path: "/other/a.md" },
    { ...projectTarget, project: "prj_01kq12a1pha000000000000001" },
    { ...projectTarget, path: "/work/notes-sibling/a.md" },
    {
      kind: "instruction_file",
      instruction_target: "ins_01kq12a1pha000000000000000",
      project: null,
      path: "/data/LOPHN.md",
    },
    { kind: "working_copy", document: "not-a-doc" },
  ];
  for (const target of targets) {
    subject.sendBytes(9, new Uint8Array([1, 2, 3]));
    const answered = await handlers.write(
      writePayload(target as Record<string, unknown>),
    );
    // working copy는 core가 확인한 근거가 없으면 쓰지 않는다.
    assert(!answered.ok, JSON.stringify(target));
    assertEquals(answered.error.code, "invalid_input");
    messages.add(answered.error.message);
  }
  assertEquals(messages.size, 1);
  assertEquals(subject.pooled, []);
  // 쓰지 않은 바이트는 우편함에 남지 않는다.
  assert(!subject.deps.inbox.take(9, 3).ok);
});

Deno.test("documents/file-tracking#R11: 이름 변경의 새 이름은 같은 등록 폴더 안이어야 한다", async () => {
  const subject = harness({
    pool: () =>
      ok({
        outcome: "renamed",
        beforePath: "/work/notes/a.md",
        afterPath: "/work/notes/b.md",
        beforeHash: HASH,
        writtenHash: null,
        observedHash: HASH,
        observedAt: "2026-10-06T00:00:00.000Z",
        changedAgain: false,
      }),
  });
  const handlers = createFileHandlers(subject.deps);
  const outside = await handlers.rename({
    request: {
      request_key: "key-2",
      target: projectTarget,
      path: "/elsewhere/b.md",
      base_hash: HASH,
    },
  });
  assert(!outside.ok);
  assertEquals(outside.error.code, "invalid_input");
  assertEquals(subject.pooled, []);
  const inside = await handlers.rename({
    request: {
      request_key: "key-2",
      target: projectTarget,
      path: "/work/notes/b.md",
      base_hash: HASH,
    },
  });
  assert(inside.ok);
  assertEquals((inside.value as FileOperationResult).outcome, "renamed");
  assertEquals(subject.pooled[0].keys, [
    "/work/notes/a.md",
    "/work/notes/b.md",
  ]);
});

Deno.test("documents/file-tracking#R1: working copy 쓰기는 core가 읽은 근거가 있어야 하고 폴더를 위에서부터 만들고 metadata를 처음 한 번 싣는다", async () => {
  const subject = harness();
  const handlers = createFileHandlers(subject.deps);
  const target = { kind: "working_copy", document: DOC };
  subject.sendBytes(9, new Uint8Array([1, 2, 3]));
  const without = await handlers.write(
    writePayload(target, { base_hash: null }),
  );
  assert(!without.ok);
  assertEquals(subject.madeDirectories, []);

  subject.sendBytes(9, new Uint8Array([1, 2, 3]));
  const answered = await handlers.write({
    ...writePayload(target, { base_hash: null }),
    working_copy: {
      base_version: VERSION,
      primary_path: "note.md",
      media_type: "text/markdown",
      confirmed_hash: HASH,
    },
  });
  assert(answered.ok);
  assertEquals(subject.madeDirectories, [
    `${DATA}/documents`,
    `${DATA}/documents/working-copies`,
    `${DATA}/documents/working-copies/${DOC}`,
  ]);
  const request = subject.pooled[0];
  const payload =
    (typeof request.payload === "function"
      ? request.payload(5)
      : request.payload) as {
        location: { root: string; path: string; meta: string };
        meta_create: string;
      };
  assertEquals(
    payload.location.path,
    `${DATA}/documents/working-copies/${DOC}/content`,
  );
  assertEquals(JSON.parse(payload.meta_create), {
    document: DOC,
    base_version: VERSION,
    primary_path: "note.md",
    media_type: "text/markdown",
    confirmed_hash: HASH,
  });
  // 사본은 이름 변경·삭제 대상이 아니다.
  const renamed = await handlers.rename({
    request: {
      request_key: "k",
      target,
      path: "/work/notes/x.md",
      base_hash: HASH,
    },
  });
  assert(!renamed.ok);
  const deleted = await handlers.delete({
    request: { request_key: "k", target, base_hash: HASH },
  });
  assert(!deleted.ok);
});

Deno.test("documents/file-tracking#R9: 읽기는 없으면 not_found, 응답 한도를 넘으면 unavailable이고 일부만 돌려주지 않는다", async () => {
  let reply: unknown = {
    exists: false,
    hash: null,
    size: 0,
    bytes_b64: null,
    meta: null,
  };
  const subject = harness({ pool: () => ok(reply) });
  const handlers = createFileHandlers(subject.deps);
  const target = { target: projectTarget };
  const missing = await handlers.read(target);
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
  reply = {
    exists: true,
    hash: HASH,
    size: 9_999_999,
    bytes_b64: null,
    meta: null,
  };
  const big = await handlers.read(target);
  assert(!big.ok);
  assertEquals(big.error.code, "unavailable");
  reply = { exists: true, hash: HASH, size: 3, bytes_b64: "AQID", meta: null };
  const small = await handlers.read(target);
  assert(small.ok);
  assertEquals(small.value, { hash: HASH, bytes_b64: "AQID" });
  assertEquals(subject.pooled[0].op, PREPARATION_OPS.readFile);
});

Deno.test("documents/file-tracking#R9: working copy 상태는 사본과 metadata로 계산하고 metadata가 없으면 판 대기로 꾸미지 않는다", async () => {
  const meta = {
    document: DOC,
    base_version: VERSION,
    primary_path: "note.md",
    media_type: "text/markdown",
    confirmed_hash: HASH,
  };
  let reply: unknown = {};
  const subject = harness({ pool: () => ok(reply) });
  const handlers = createFileHandlers(subject.deps);
  const target = { kind: "working_copy" as const, document: DOC };
  reply = { exists: false, hash: null, size: 0, bytes_b64: null, meta: null };
  const absent = await handlers.observation(target);
  assert(absent.ok);
  assertEquals(absent.value, undefined);
  reply = { exists: true, hash: HASH, size: 1, bytes_b64: "AQ==", meta };
  const same = await handlers.observation(target);
  assert(same.ok && same.value);
  assertEquals(same.value.observedHash, HASH);
  assertEquals(same.value.latestHash, HASH);
  assertEquals(same.value.comparedVersion, VERSION);
  assertEquals(same.value.unverified, false);
  reply = { exists: true, hash: OTHER, size: 1, bytes_b64: "AQ==", meta };
  const edited = await handlers.observation(target);
  assert(edited.ok && edited.value);
  assertEquals(edited.value.latestHash, HASH);
  assertEquals(edited.value.observedHash, OTHER);
  reply = { exists: true, hash: HASH, size: 1, bytes_b64: "AQ==", meta: null };
  const unknown = await handlers.observation(target);
  assert(unknown.ok && unknown.value);
  assertEquals(unknown.value.unverified, true);
  assertEquals(unknown.value.comparedVersion, null);
});

Deno.test("documents/file-tracking#R9: watch는 처음 묻거나 달라졌으면 바로, 같으면 기한까지 기다린 뒤 답한다", async () => {
  const subject = harness({ watchWaitMs: 150 });
  const handlers = createFileHandlers(subject.deps);
  const target = {
    kind: "project_file" as const,
    project: PROJECT,
    path: "/work/notes/a.md",
  };
  const first = await handlers.watch({ target });
  assert(first.ok);
  const cursor = (first.value as { next_cursor: string }).next_cursor;
  const started = Date.now();
  const again = await handlers.watch({ target, cursor });
  assert(again.ok);
  assert(Date.now() - started >= 100, "변화가 없으면 기한까지 기다린다");
  // 관측이 바뀌면 기다리지 않고 답한다.
  subject.deps.status.report(target, {
    tracked: true,
    missing: false,
    unverified: false,
    validationFailed: false,
    observedHash: HASH,
    latestHash: OTHER,
    observedAt: "2026-10-06T00:00:00.000Z",
    comparedVersion: VERSION,
    projectRevision: "3",
    details: null,
  });
  const changedAt = Date.now();
  const changed = await handlers.watch({ target, cursor });
  assert(changed.ok);
  assert(Date.now() - changedAt < 100);
  assertEquals(
    (changed.value as { status: { state: string } }).status.state,
    "version_pending",
  );
  // 범위 밖 목표의 변화는 알려 주지 않는다.
  const outside = await handlers.watch({
    target: { ...target, path: "/other/a.md" },
  });
  assert(!outside.ok);
  assertEquals(outside.error.code, "invalid_input");
});

Deno.test("documents/file-tracking#R1: working copy 확정은 사본 폴더의 metadata만 가리킨다", async () => {
  const subject = harness({ pool: () => ok({ confirmed: true }) });
  const handlers = createFileHandlers(subject.deps);
  const done = await handlers.confirmCopy({
    document: DOC,
    base_version: VERSION,
    confirmed_hash: HASH,
  });
  assert(done.ok);
  assertEquals(subject.pooled[0].op, PREPARATION_OPS.confirmCopy);
  assertEquals(subject.pooled[0].payload, {
    root: `${DATA}/documents/working-copies/${DOC}`,
    meta: `${DATA}/documents/working-copies/${DOC}/meta.json`,
    base_version: VERSION,
    confirmed_hash: HASH,
  });
  const bad = await handlers.confirmCopy({
    document: "../../etc",
    base_version: VERSION,
    confirmed_hash: HASH,
  });
  assert(!bad.ok);
  void DOCUMENT_OPS;
});
