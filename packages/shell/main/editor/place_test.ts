// 문서를 파일로 두기의 main 통로(shell#T20). core 통로를 주입해 files/write에 무엇을 싣고
// 단계별 결과를 어떻게 돌려주는지 본다. 순서와 확정은 core(documents#T19)가 시험한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlacer, type PlacedResult, type PlacePort } from "./place.ts";
import type { FixedRead } from "./restore.ts";
import type { PortResult } from "./file-adapter.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const V1 = "ver_01kq12a1pha000000000000001";
const PROJECT = "prj_01kq12a1pha000000000000000";
const PATH = "/home/someone/notes/plan.md";
const HASH = "ab".repeat(32);

function fixed(files: FixedRead["version"]["files"]): FixedRead {
  return {
    document: {
      id: DOC,
      latest_version: V1,
      revision: "3",
      status: "active",
      file_source: null,
    },
    version: {
      id: V1,
      number: 1,
      content_hash: "cd".repeat(32),
      files,
      format: {
        name: "document",
        module_hash: "ef".repeat(32),
        explicit: true,
      },
    },
  };
}

const ONE_FILE = [{
  path: "plan.md",
  blob_hash: HASH,
  bytes: 12,
  media_type: "text/markdown",
  primary: true,
}];

function port(
  files: FixedRead["version"]["files"],
  write: () => PortResult<PlacedResult>,
) {
  const writes: unknown[] = [];
  const value: PlacePort = {
    fixed: () => Promise.resolve({ ok: true, value: fixed(files) }),
    write: (request) => {
      writes.push(request);
      return Promise.resolve(write());
    },
  };
  return { value, writes };
}

const INPUT = {
  document: DOC,
  version: V1,
  project: PROJECT,
  path: PATH,
  request_key: "place-0123456789abcdef",
};

test("documents/file-tracking#R13: 두기는 그 판의 유일한 파일 원본 참조로 새 파일을 쓰고 단계별 결과를 그대로 돌려준다", async () => {
  const fake = port(ONE_FILE, () => ({
    ok: true,
    value: {
      outcome: "written",
      after_path: PATH,
      placement: {
        source: { state: "done" },
        tracking: {
          state: "failed",
          error: { code: "forbidden", message: "scope" },
        },
        move: { state: "not_attempted" },
      },
    },
  }));
  const reply = await createPlacer(() => fake.value).place(INPUT);
  assert.deepEqual(fake.writes, [{
    request_key: INPUT.request_key,
    target: { kind: "project_file", project: PROJECT, path: PATH },
    base_hash: null,
    content: {
      kind: "existing",
      reference: {
        owner_kind: "document_version",
        owner_key: `${V1}/plan.md`,
        field: "file",
        hash: HASH,
        registered_seq: "1",
      },
    },
    place: { document: DOC, version: V1 },
  }]);
  assert.deepEqual(reply, {
    ok: true,
    value: {
      file: "written",
      path: PATH,
      steps: {
        source: { state: "done" },
        tracking: { state: "failed", code: "forbidden" },
        move: { state: "not_attempted" },
      },
      failure: null,
    },
  });
});

test("documents/file-tracking#R13: 여러 파일 판은 두지 않고, 이미 있는 파일·낡은 판은 conflict로 파일을 쓰지 않았다고 알린다", async () => {
  const many = port([...ONE_FILE, { ...ONE_FILE[0]!, path: "b.md" }], () => {
    throw new Error("쓰면 안 된다");
  });
  assert.deepEqual(await createPlacer(() => many.value).place(INPUT), {
    ok: false,
    code: "unsupported",
  });
  assert.equal(many.writes.length, 0);
  const taken = port(ONE_FILE, () => ({
    ok: false,
    error: { code: "conflict", message: "exists" },
  }));
  assert.deepEqual(await createPlacer(() => taken.value).place(INPUT), {
    ok: true,
    value: { file: "conflict", path: null, steps: null, failure: "conflict" },
  });
  assert.deepEqual(await createPlacer(() => null).place(INPUT), {
    ok: false,
    code: "offline",
  });
});
