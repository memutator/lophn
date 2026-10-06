// [Instructions]의 main 통로(shell#T32, shell/editor#R17). core 통로를 주입해 exact 지침 파일 대상 resolve,
// 없는 파일의 빈 초안, 사람의 첫 저장(미존재 CAS), 연결 문서가 생기기까지의 기다림을 본다. 실제 core 위의
// 같은 흐름(외부 변경 충돌·version 비교·복원)은 renderer/editor/instructions-real-core_test.ts가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createInstructions,
  type InstructionsPort,
  type PlacelessDocument,
} from "./instructions.ts";
import type { PortError, WriteRequest } from "./file-adapter.ts";

const HOME = "/data/lophn";
const PROJECT = "prj_01kq12a1pha000000000000000";
const APP = "app_01kq12a1pha000000000000000";
const DOC = "doc_01kq12a1pha000000000000000";
const V1 = "ver_01kq12a1pha000000000000001";
const BYTES = new TextEncoder().encode("Always answer briefly.\n");

const linked = (target: string): PlacelessDocument => ({
  id: DOC,
  latest_version: V1,
  file_source: { kind: "instruction_file", instruction_target: target },
});

function fakePort(
  options: {
    project?: { status: string; folders: { path: string }[] } | PortError;
    documents?: () => PlacelessDocument[];
    write?: () => { ok: true } | { ok: false; error: PortError };
  } = {},
) {
  const writes: WriteRequest[] = [];
  const calls: string[] = [];
  const port: InstructionsPort = {
    project: (id) => {
      calls.push(`project ${id}`);
      const project = options.project ?? {
        status: "active",
        folders: [{ path: "/work/alpha" }, { path: "/work/beta" }],
      };
      return Promise.resolve(
        "code" in project
          ? { ok: false, error: project }
          : { ok: true, value: project },
      );
    },
    placeless: () => {
      calls.push("placeless");
      return Promise.resolve({
        ok: true,
        value: options.documents?.() ?? [],
      });
    },
    upload: (bytes, hash) =>
      Promise.resolve({
        ok: true,
        value: {
          preparation: "prep_1",
          principal: "user",
          purpose: "document_file",
          hash,
          size_bytes: bytes.byteLength,
        },
      }),
    write: (request) => {
      writes.push(request);
      const answer = options.write?.() ?? { ok: true as const };
      return Promise.resolve(
        answer.ok
          ? {
            ok: true,
            value: {
              outcome: "written",
              written_hash: request.content.blob.hash,
              observed_hash: request.content.blob.hash,
              observed_at: null,
              changed_again: null,
              recording: "unverified",
              version_result: "not_requested",
            },
          }
          : answer,
      );
    },
  };
  return { port, writes, calls };
}

function instructions(port: InstructionsPort) {
  return createInstructions({
    port: () => port,
    dataRoot: HOME,
    sleep: () => Promise.resolve(),
    waits: 3,
  });
}

test("shell/editor#R17: 전역 지침은 data root 바로 아래 LOPHN.md 하나만 대상이고 renderer에는 문서 id와 판만 돌려준다", async () => {
  const absent = fakePort();
  assert.deepEqual(
    await instructions(absent.port).open({ target: { layer: "global" } }),
    { ok: true, value: { document: null, version: null } },
  );
  const present = fakePort({ documents: () => [linked("global")] });
  const opened = await instructions(present.port).open({
    target: { layer: "global" },
  });
  assert.deepEqual(opened, { ok: true, value: { document: DOC, version: V1 } });
  // 다른 층 문서(project 지침)는 전역 대상으로 열리지 않는다.
  const other = fakePort({ documents: () => [linked(`project:${PROJECT}`)] });
  assert.deepEqual(
    await instructions(other.port).open({ target: { layer: "global" } }),
    { ok: true, value: { document: null, version: null } },
  );
  // 경로·target 이름은 응답 어디에도 없다.
  assert.ok(!JSON.stringify(opened).includes("LOPHN.md"));
  assert.ok(!JSON.stringify(opened).includes(HOME));
});

test("shell/editor#R17: project 지침은 활성 project의 첫 등록 폴더 바로 아래 LOPHN.md만 대상이다", async () => {
  const fake = fakePort({
    documents: () => [linked(`project:${PROJECT}`)],
  });
  const opened = await instructions(fake.port).open({
    target: { layer: "project", place: PROJECT },
  });
  assert.deepEqual(opened, { ok: true, value: { document: DOC, version: V1 } });
  // 없는 project·보관된 project·폴더 없는 project는 같은 not_found다.
  const missing = fakePort({
    project: { code: "not_found", message: "no project" },
  });
  const archived = fakePort({ project: { status: "archived", folders: [] } });
  const bare = fakePort({ project: { status: "active", folders: [] } });
  for (const fake of [missing, archived, bare]) {
    assert.deepEqual(
      await instructions(fake.port).open({
        target: { layer: "project", place: PROJECT },
      }),
      { ok: false, code: "not_found" },
    );
  }
});

test("shell/editor#R17: 범위 밖 app 층은 없는 project와 똑같이 not_found로 답하고 core를 부르지 않는다", async () => {
  const fake = fakePort();
  const app = await instructions(fake.port).open({
    target: { layer: "app", place: APP },
  });
  const missing = await instructions(
    fakePort({ project: { code: "not_found", message: "no project" } }).port,
  ).open({ target: { layer: "project", place: PROJECT } });
  assert.deepEqual(app, missing);
  assert.deepEqual(fake.calls, []);
  const created = await instructions(fake.port).create({
    target: { layer: "app", place: APP },
    request_key: "instr-app-00000000001",
    bytes: BYTES,
  });
  assert.deepEqual(created, { ok: false, code: "not_found" });
  assert.deepEqual(fake.writes, []);
});

test("shell/editor#R17: 파일이 없으면 사람의 첫 저장이 exact 지침 파일 대상에 미존재 CAS로 쓰고 연결 문서가 생기면 판을 돌려준다", async () => {
  let reads = 0;
  // 첫 읽기(저장 전)에는 연결 문서가 없고, 쓰기 뒤 다시 읽을 때 documents가 만든 첫 판이 보인다.
  const fake = fakePort({
    documents: () => (reads++ === 0 ? [] : [linked("global")]),
  });
  const created = await instructions(fake.port).create({
    target: { layer: "global" },
    request_key: "instr-global-0000000001",
    bytes: BYTES,
  });
  assert.deepEqual(created, {
    ok: true,
    value: { outcome: "saved", version: V1, failure: null, document: DOC },
  });
  assert.equal(fake.writes.length, 1);
  const write = fake.writes[0]!;
  assert.deepEqual(write.target, {
    kind: "instruction_file",
    instruction_target: "global",
    project: null,
    path: `${HOME}/LOPHN.md`,
  });
  assert.equal(write.base_hash, null);
  assert.equal(write.request_key, "instr-global-0000000001");
  assert.equal(write.version_request, undefined);
  assert.equal(write.content.kind, "prepared");

  const project = fakePort({ documents: () => [] });
  await instructions(project.port).create({
    target: { layer: "project", place: PROJECT },
    request_key: "instr-project-000000001",
    bytes: BYTES,
  });
  assert.deepEqual(project.writes[0]!.target, {
    kind: "instruction_file",
    instruction_target: `project:${PROJECT}`,
    project: PROJECT,
    path: "/work/alpha/LOPHN.md",
  });
});

test("shell/editor#R2 shell/editor#R17: 파일은 썼지만 첫 판이 아직 관측되지 않으면 pending이고, 이미 연결된 문서가 있으면 첫 저장을 하지 않는다", async () => {
  const waiting = fakePort();
  const pending = await instructions(waiting.port).create({
    target: { layer: "global" },
    request_key: "instr-pending-000000001",
    bytes: BYTES,
  });
  assert.deepEqual(pending, {
    ok: true,
    value: { outcome: "pending", version: null, failure: null, document: null },
  });
  assert.equal(waiting.writes.length, 1);

  const existing = fakePort({ documents: () => [linked("global")] });
  const conflict = await instructions(existing.port).create({
    target: { layer: "global" },
    request_key: "instr-existing-00000001",
    bytes: BYTES,
  });
  assert.deepEqual(conflict, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      failure: null,
      document: DOC,
    },
  });
  assert.deepEqual(existing.writes, []);
});

test("shell/editor#R17: 외부에 이미 생긴 파일(409)은 conflict, 응답 유실은 unknown이고 자동으로 다시 쓰지 않는다", async () => {
  const exists = fakePort({
    write: () => ({
      ok: false,
      error: { code: "conflict", message: "file exists" },
    }),
  });
  const conflict = await instructions(exists.port).create({
    target: { layer: "global" },
    request_key: "instr-external-00000001",
    bytes: BYTES,
  });
  assert.deepEqual(conflict, {
    ok: true,
    value: {
      outcome: "conflict",
      version: null,
      failure: null,
      document: null,
    },
  });
  const lost = fakePort({
    write: () => ({
      ok: false,
      error: {
        code: "unavailable",
        message: "lost",
        details: { reason: "transport_failed" },
      },
    }),
  });
  const unknown = await instructions(lost.port).create({
    target: { layer: "global" },
    request_key: "instr-lost-00000000001",
    bytes: BYTES,
  });
  assert.deepEqual(unknown, {
    ok: true,
    value: {
      outcome: "unknown",
      version: null,
      failure: "unknown",
      document: null,
    },
  });
  assert.equal(lost.writes.length, 1);
  // 연결된 core가 없으면 열기와 저장은 offline이다.
  const offline = createInstructions({ port: () => null, dataRoot: HOME });
  assert.deepEqual(await offline.open({ target: { layer: "global" } }), {
    ok: false,
    code: "offline",
  });
  assert.deepEqual(
    await offline.create({
      target: { layer: "global" },
      request_key: "instr-offline-0000000001",
      bytes: BYTES,
    }),
    {
      ok: true,
      value: {
        outcome: "failed",
        version: null,
        failure: "offline",
        document: null,
      },
    },
  );
});
