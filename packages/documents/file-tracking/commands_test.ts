import { assert, assertEquals, assertFalse } from "@std/assert";
import type {
  FileOperationResult,
  FileTarget,
} from "../../contracts/documents/mod.ts";
import { projectsSchemaSteps } from "../projects/mod.ts";
import { ids, userContext, versionFixture } from "../versions/testing/mod.ts";
import { createFileCommands } from "./commands.ts";

const commands = createFileCommands();
const HASH_A = "a1".repeat(32);
const HASH_B = "b2".repeat(32);

function fixture() {
  const opened = versionFixture();
  for (const step of projectsSchemaSteps) opened.db.exec(step.sql);
  opened.db.exec(
    `INSERT INTO projects (id, name, title, purpose, tracking_enabled,
       use_gitignore, revision, status)
     VALUES ('${ids.project}', 'alpha', 'Alpha', '', 1, 0, '1', 'active')`,
  );
  // 원본 연결이 없는 문서(working copy 대상)와 원본에 연결된 문서.
  opened.db.exec(
    `INSERT INTO documents (id, title, latest_version, revision, status)
     VALUES ('${ids.doc}', 'loose', 'ver_${"0".repeat(26)}', '1', 'active')`,
  );
  opened.db.exec(
    `INSERT INTO documents (id, title, source_kind, source_project, source_path,
       latest_version, revision, status)
     VALUES ('${ids.other}', 'linked', 'project_file', '${ids.project}',
       '/work/a.md', 'ver_${"0".repeat(26)}', '1', 'active')`,
  );
  return opened;
}

const projectTarget: FileTarget = {
  kind: "project_file",
  project: ids.project,
  path: "/work/a.md",
};

function result(
  overrides: Partial<FileOperationResult> = {},
): FileOperationResult {
  return {
    request_key: "req-1",
    operation: "write",
    target: projectTarget,
    outcome: "written",
    before_path: "/work/a.md",
    after_path: "/work/a.md",
    before_hash: HASH_A,
    written_hash: HASH_B,
    observed_hash: HASH_B,
    observed_at: "2026-10-06T00:00:00.000Z",
    changed_again: false,
    recording: "unverified",
    event_seq: null,
    version_result: "not_requested",
    ...overrides,
  } as FileOperationResult;
}

function record(
  opened: ReturnType<typeof fixture>,
  input: FileOperationResult,
  actor = "machine",
) {
  return opened.transaction((tx) =>
    commands.recordResult.handle(tx, userContext(actor), input, {})
  );
}

Deno.test("documents/file-tracking#R15 documents/file-tracking#R16: 성공한 파일 작업마다 경로와 hash만 담은 event 하나를 남긴다", () => {
  const opened = fixture();
  try {
    const written = record(opened, result());
    assert(written.ok);
    assertEquals(written.value.recording, "recorded");
    assertEquals(written.value.event_seq, "1");
    const renamed = record(
      opened,
      result({
        operation: "rename",
        outcome: "renamed",
        before_path: "/work/a.md",
        after_path: "/work/b.md",
        written_hash: null,
        request_key: "req-2",
      }),
    );
    assert(renamed.ok);
    const deleted = record(
      opened,
      result({
        operation: "delete",
        outcome: "deleted",
        before_path: "/work/b.md",
        after_path: null,
        written_hash: null,
        observed_hash: null,
        observed_at: null,
        changed_again: null,
        request_key: "req-3",
      }),
    );
    assert(deleted.ok);
    assertEquals(opened.emitted.map((event) => event.type), [
      "FileWritten",
      "FileRenamed",
      "FileDeleted",
    ]);
    assertEquals(opened.emitted[0].subject, ids.project);
    assertEquals(opened.emitted[0].payload, {
      path: "/work/a.md",
      before_hash: HASH_A,
      after_hash: HASH_B,
    });
    assertEquals(opened.emitted[1].payload, {
      before_path: "/work/a.md",
      after_path: "/work/b.md",
      before_hash: HASH_A,
      after_hash: HASH_A,
    });
    assertEquals(opened.emitted[2].payload, {
      path: "/work/b.md",
      before_hash: HASH_A,
      after_hash: null,
    });
    // 본문은 어떤 event에도 없다.
    assertFalse(JSON.stringify(opened.emitted).includes("content"));
  } finally {
    opened.close();
  }
});

Deno.test("documents/file-tracking#R17: 같은 편집 세션의 저장과 이름 변경은 각각 event다", () => {
  const opened = fixture();
  try {
    assert(record(opened, result({ request_key: "session-1-write" })).ok);
    assert(
      record(
        opened,
        result({
          request_key: "session-1-rename",
          operation: "rename",
          outcome: "renamed",
          after_path: "/work/b.md",
          written_hash: null,
        }),
      ).ok,
    );
    assertEquals(opened.emitted.length, 2);
  } finally {
    opened.close();
  }
});

Deno.test("documents/file-tracking#R2: file.record_result는 machine만 기록한다", () => {
  for (
    const actor of [
      "user",
      "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
      "agent:asg_01arz3ndektsv4rrffq69g5fav",
      "app:app_01arz3ndektsv4rrffq69g5fav",
    ]
  ) {
    const opened = fixture();
    try {
      const rejected = record(opened, result(), actor);
      assert(!rejected.ok);
      assertEquals(rejected.error.code, "forbidden");
      assertEquals(opened.emitted, []);
    } finally {
      opened.close();
    }
  }
});

Deno.test("documents/file-tracking#R15: 성공하지 않은 결과·어긋난 결과·없는 대상은 invalid_input이고 event가 없다", () => {
  const opened = fixture();
  try {
    const rejected = [
      result({ outcome: "unverified" }),
      result({ outcome: "renamed" }),
      result({ written_hash: null }),
      result({ after_path: null }),
      result({
        operation: "rename",
        outcome: "renamed",
        before_hash: null,
      }),
      result({
        operation: "delete",
        outcome: "deleted",
        before_path: null,
      }),
      result({
        target: {
          kind: "project_file",
          project: "prj_01arz3ndektsv4rrffq69g5faw",
          path: "/work/a.md",
        },
      }),
      // 원본에 연결된 문서는 working copy 대상이 아니다.
      result({ target: { kind: "working_copy", document: ids.other } }),
      result({
        target: {
          kind: "working_copy",
          document: "doc_01arz3ndektsv4rrffq69g5fax",
        },
      }),
    ];
    for (const input of rejected) {
      const done = record(opened, input);
      assert(!done.ok);
      assertEquals(done.error.code, "invalid_input");
    }
    assertEquals(opened.emitted, []);
  } finally {
    opened.close();
  }
});

Deno.test("documents/file-tracking#R1: 원본 없는 문서의 working copy 쓰기는 그 문서를 subject로 남긴다", () => {
  const opened = fixture();
  try {
    const done = record(
      opened,
      result({
        target: { kind: "working_copy", document: ids.doc },
        before_path: "/data/documents/working-copies/doc/content",
        after_path: "/data/documents/working-copies/doc/content",
      }),
    );
    assert(done.ok);
    assertEquals(opened.emitted[0].subject, ids.doc);
  } finally {
    opened.close();
  }
});
