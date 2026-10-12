import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { FileSource } from "../../../protocol/projects/mod.ts";
import { createFileCommands } from "../file-tracking/mod.ts";
import { createProjectCommands, projectsSchemaSteps } from "../registry/mod.ts";
import { createSourceCommands } from "./source.ts";
import { createVersionCommands } from "./commands.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing/mod.ts";

const commands = createSourceCommands();
const versions = createVersionCommands();
const ROOT = "/work/notes";

function fixtureWithProject(status = "active") {
  const fixture = versionFixture();
  for (const step of projectsSchemaSteps) fixture.db.exec(step.sql);
  fixture.db.exec(
    `INSERT INTO projects (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
     VALUES ('${ids.project}', 'notes', 'Notes', '', 1, 1, '1', '${status}')`,
  );
  fixture.db.exec(
    `INSERT INTO project_folders (project, position, path, description)
     VALUES ('${ids.project}', 0, '${ROOT}', '')`,
  );
  return fixture;
}

function saveDocument(
  fixture: ReturnType<typeof versionFixture>,
  document = ids.doc,
  key = "save-1",
) {
  const result = fixture.transaction((tx) =>
    versions.save.handle(
      tx,
      userContext(),
      preparedInput(document, [file("a.md", true)], {
        idempotency_key: key,
      }) as never,
      { base_version: null },
    )
  );
  return keep(result);
}

function revisionOf(
  fixture: ReturnType<typeof versionFixture>,
  document = ids.doc,
): string {
  const row = fixture.sql.get("SELECT revision FROM documents WHERE id = ?", [
    document,
  ]);
  return String(row?.["revision"]);
}

function setSource(
  fixture: ReturnType<typeof versionFixture>,
  fileSource: FileSource | null,
  options: {
    document?: string;
    actor?: string;
    base?: string;
  } = {},
) {
  const document = options.document ?? ids.doc;
  return fixture.transaction((tx) =>
    commands.setSource.handle(
      tx,
      userContext(options.actor ?? "user"),
      { document, file_source: fileSource },
      { base_revision: options.base ?? revisionOf(fixture, document) },
    )
  );
}

function projectFile(path: string): FileSource {
  return { kind: "project_file", project: ids.project, path };
}

Deno.test("documents/versions#R13: 사람이 원본 연결을 걸면 DocumentSourceChanged와 새 revision으로 확정된다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    const before = revisionOf(fixture);
    const source = projectFile(`${ROOT}/a.md`);
    const linked = keep(setSource(fixture, source));
    assertEquals(linked.file_source, source);
    assert(BigInt(linked.revision) > BigInt(before));
    const event = fixture.emitted.at(-1)!;
    assertEquals(event.type, "DocumentSourceChanged");
    assertEquals(event.subject, ids.doc);
    assertEquals(event.payload, {
      before_source: null,
      source,
      before_revision: before,
    });
    const row = fixture.sql.get(
      "SELECT source_kind, source_project, source_path FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(row?.["source_path"], `${ROOT}/a.md`);
    // 연결은 최신 판을 바꾸지 않는다.
    const versionsAfter = fixture.sql.all(
      "SELECT id FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(versionsAfter.length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 연결 해제도 사람의 명시 command이고 해제 뒤 같은 경로를 다시 걸 수 있다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    const source = projectFile(`${ROOT}/a.md`);
    keep(setSource(fixture, source));
    const unlinked = keep(setSource(fixture, null));
    assertEquals(unlinked.file_source, null);
    const event = fixture.emitted.at(-1)!;
    assertEquals(event.type, "DocumentSourceChanged");
    assertEquals(
      (event.payload as { before_source: unknown }).before_source,
      source,
    );
    assertEquals((event.payload as { source: unknown }).source, null);
    // 해제한 문서에는 다시 걸 수 있다(재연결).
    assertEquals(keep(setSource(fixture, source)).file_source, source);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 연결 변경은 user만이고 agent·coding agent·machine·app은 forbidden이다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    for (
      const actor of [
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "machine",
        "app:app_01arz3ndektsv4rrffq69g5fav",
      ]
    ) {
      const rejected = setSource(fixture, projectFile(`${ROOT}/a.md`), {
        actor,
      });
      assert(!rejected.ok, actor);
      assertEquals(rejected.error.code, "forbidden", actor);
    }
    assertEquals(
      fixture.sql.get("SELECT source_path FROM documents WHERE id = ?", [
        ids.doc,
      ])?.["source_path"],
      null,
    );
    assertEquals(
      fixture.emitted.filter((e) => e.type === "DocumentSourceChanged").length,
      0,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 낡은 base_revision·같은 연결·이미 쓰는 경로는 거절하고 아무것도 바꾸지 않는다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    saveDocument(fixture, ids.other, "save-2");
    const stale = revisionOf(fixture);
    const source = projectFile(`${ROOT}/a.md`);
    keep(setSource(fixture, source));
    // 연결이 revision을 올렸으므로 이전 기준은 낡았다.
    const late = setSource(fixture, null, { base: stale });
    assert(!late.ok);
    assertEquals(late.error.code, "conflict");
    // 같은 연결로 바꾸는 요청은 변경이 아니다.
    const same = setSource(fixture, source);
    assert(!same.ok);
    assertEquals(same.error.code, "invalid_input");
    // 다른 문서가 쓰는 경로는 conflict다.
    const taken = setSource(fixture, source, { document: ids.other });
    assert(!taken.ok);
    assertEquals(taken.error.code, "conflict");
    assertEquals(
      fixture.emitted.filter((e) => e.type === "DocumentSourceChanged").length,
      1,
    );
    assertEquals(
      fixture.sql.get("SELECT source_path FROM documents WHERE id = ?", [
        ids.other,
      ])?.["source_path"],
      null,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 등록 폴더 밖·없는 프로젝트·.git 안·보관된 프로젝트는 같은 invalid_input이다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    const outside = [
      projectFile("/elsewhere/a.md"),
      projectFile(`${ROOT}-other/a.md`),
      projectFile(ROOT),
      projectFile(`${ROOT}/.git/config`),
      {
        kind: "project_file" as const,
        project: ids.other.replace("doc", "prj"),
        path: `${ROOT}/a.md`,
      },
    ];
    const messages = new Set<string>();
    for (const source of outside) {
      const rejected = setSource(fixture, source);
      assert(!rejected.ok);
      assertEquals(rejected.error.code, "invalid_input");
      messages.add(rejected.error.message);
    }
    // 이유를 구별해 알리지 않는다.
    assertEquals(messages.size, 1);
    fixture.db.exec("UPDATE projects SET status = 'archived'");
    const archived = setSource(fixture, projectFile(`${ROOT}/a.md`));
    assert(!archived.ok);
    assertEquals(archived.error.code, "invalid_input");
    assertEquals(
      fixture.emitted.filter((e) => e.type === "DocumentSourceChanged").length,
      0,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 보관된 문서에는 연결을 걸지 못하지만 풀 수는 있고 지침 파일 연결은 여기서 바꾸지 않는다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    keep(setSource(fixture, projectFile(`${ROOT}/a.md`)));
    fixture.db.exec("UPDATE documents SET status = 'archived'");
    assertEquals(keep(setSource(fixture, null)).file_source, null);
    const archived = setSource(fixture, projectFile(`${ROOT}/b.md`));
    assert(!archived.ok);
    assertEquals(archived.error.code, "conflict");
    fixture.db.exec("UPDATE documents SET status = 'active'");
    const instruction = setSource(fixture, {
      kind: "instruction_file",
      instruction_target: "agents",
      project: ids.project,
      path: `${ROOT}/AGENTS.md`,
    } as never);
    assert(!instruction.ok);
    assertEquals(instruction.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 없는 문서는 not_found고 권한 판정이 거절하면 그 거절을 따른다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    const missing = fixture.transaction((tx) =>
      commands.setSource.handle(
        tx,
        userContext(),
        { document: ids.other, file_source: projectFile(`${ROOT}/a.md`) },
        { base_revision: "1" },
      )
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
    fixture.use(() => err({ code: "forbidden", message: "out of scope" }));
    const denied = setSource(fixture, projectFile(`${ROOT}/a.md`));
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    fixture.use(() => ok(undefined));
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 파일 삭제 기록과 추적 해제만으로는 원본 연결이 사라지지 않는다", () => {
  const fixture = fixtureWithProject();
  try {
    saveDocument(fixture);
    const source = projectFile(`${ROOT}/a.md`);
    keep(setSource(fixture, source));
    // 파일이 지워졌다고 기록된다(FileDeleted).
    const deleted = fixture.transaction((tx) =>
      createFileCommands().recordResult.handle(
        tx,
        userContext("machine"),
        {
          request_key: "req-1",
          operation: "delete",
          target: {
            kind: "project_file",
            project: ids.project,
            path: `${ROOT}/a.md`,
          },
          outcome: "deleted",
          before_path: `${ROOT}/a.md`,
          after_path: null,
          before_hash: "ab".repeat(32),
          written_hash: null,
          observed_hash: null,
          observed_at: null,
          changed_again: null,
          recording: "unverified",
          event_seq: null,
          version_result: "not_requested",
        },
        {},
      )
    );
    assert(deleted.ok);
    // 추적을 끈다(ProjectTrackingChanged).
    const folders = [{ path: ROOT, description: "" }];
    const tracking = { enabled: false, patterns: [], use_gitignore: true };
    const stopped = fixture.transaction((tx) =>
      createProjectCommands().setTracking.handle(tx, userContext(), {
        project: ids.project,
        folders,
        tracking,
        preview: {
          project: ids.project,
          base_revision: "1",
          folders,
          tracking,
          observed_at: "2026-10-06T00:00:00.000Z",
          entries: [],
          complete: true,
          next_cursor: null,
        },
      }, { base_revision: "1" })
    );
    assert(stopped.ok);
    const types = fixture.emitted.map((event) => event.type);
    assert(types.includes("FileDeleted"));
    assert(types.includes("ProjectTrackingChanged"));
    const row = fixture.sql.get(
      "SELECT source_project, source_path FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(row?.["source_path"], source.path);
    assertEquals(row?.["source_project"], ids.project);
    // 연결은 사람이 푼 때만 사라진다.
    assertEquals(keep(setSource(fixture, null)).file_source, null);
  } finally {
    fixture.close();
  }
});
