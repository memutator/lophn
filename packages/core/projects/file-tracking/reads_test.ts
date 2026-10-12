import { assert, assertEquals } from "@std/assert";
import { projectsSchemaSteps } from "../registry/mod.ts";
import { ids, userContext, versionFixture } from "../versions/testing/mod.ts";
import { createFileReads, workingCopyCheck } from "./reads.ts";

const reads = createFileReads();
// 문서마다 판 id가 겹치지 않게 문서 id의 끝에서 만든다(문서 205개·판 두 개까지 서로 다르다).
function versionId(document: string, number: number): string {
  return `ver_${document.slice(5)}${number}`;
}
const HASH = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function fixture() {
  const opened = versionFixture();
  for (const step of projectsSchemaSteps) opened.db.exec(step.sql);
  for (
    const [id, name, status] of [
      [ids.project, "alpha", "active"],
      ["prj_01arz3ndektsv4rrffq69g5faw", "beta", "active"],
      ["prj_01arz3ndektsv4rrffq69g5fax", "old", "archived"],
    ]
  ) {
    opened.db.exec(
      `INSERT INTO projects (id, name, title, purpose, tracking_enabled,
         use_gitignore, revision, status)
       VALUES ('${id}', '${name}', '${name}', '', 1, 0, '1', '${status}')`,
    );
  }
  return opened;
}

function document(
  opened: ReturnType<typeof fixture>,
  id: string,
  options: {
    project?: string;
    path?: string;
    status?: "active" | "archived";
    versions?: number;
  } = {},
) {
  const count = options.versions ?? 1;
  opened.db.exec(
    `INSERT INTO documents (id, title, ${
      options.path ? "source_kind, source_project, source_path," : ""
    } latest_version, revision, status)
     VALUES ('${id}', 'doc', ${
      options.path
        ? `'project_file', '${options.project}', '${options.path}',`
        : ""
    } '${versionId(id, count)}', '1', '${options.status ?? "active"}')`,
  );
  for (let number = 1; number <= count; number++) {
    const unique = versionId(id, number);
    opened.db.exec(
      `INSERT INTO versions (id, document, number, files_hash, primary_path,
         file_count, content_hash, format_name, module_hash, format_explicit,
         saved_by, saved_at, run, source)
       VALUES ('${unique}', '${id}', ${number}, '${HASH}', 'note.md', 1,
         '${HASH}', 'document', '${HASH}', 0, 'user', '2026-10-06T00:00:00.000Z',
         NULL, NULL)`,
    );
    opened.db.exec(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type,
         primary_file) VALUES ('${unique}', 'note.md', '${
        number === 1 ? HASH : OTHER
      }', 4, 'text/markdown', 1)`,
    );
  }
}

const D = (suffix: string) => `doc_${suffix.padStart(26, "0")}`;

Deno.test("documents/file-tracking#R1 documents/file-tracking#R2: files.list는 원본에 연결된 활성 project 파일과 원본 없는 문서의 working copy만 user에게 보인다", () => {
  const opened = fixture();
  try {
    document(opened, D("1"), { project: ids.project, path: "/work/b.md" });
    document(opened, D("2"), { project: ids.project, path: "/work/a.md" });
    document(opened, D("3"), {
      project: "prj_01arz3ndektsv4rrffq69g5faw",
      path: "/other/c.md",
    });
    // 보관 문서, 보관 project의 문서는 편집 목록에 없다.
    document(opened, D("4"), {
      project: ids.project,
      path: "/work/archived.md",
      status: "archived",
    });
    document(opened, D("5"), {
      project: "prj_01arz3ndektsv4rrffq69g5fax",
      path: "/old/x.md",
    });
    document(opened, D("6"));
    document(opened, D("7"), { status: "archived" });
    const all = reads.list.handle(opened.snapshot(), userContext(), {});
    assert(all.ok);
    // project 파일은 경로 순서고 사본이 그 뒤다.
    assertEquals(all.value.targets, [
      {
        kind: "project_file",
        project: "prj_01arz3ndektsv4rrffq69g5faw",
        path: "/other/c.md",
      },
      { kind: "project_file", project: ids.project, path: "/work/a.md" },
      { kind: "project_file", project: ids.project, path: "/work/b.md" },
      { kind: "working_copy", document: D("6") },
    ]);
    assertEquals(all.value.next_cursor, null);
    // project를 정하면 그 project 파일만이다. 모르는 project는 빈 목록이다.
    const scoped = reads.list.handle(opened.snapshot(), userContext(), {
      project: ids.project,
    });
    assert(scoped.ok);
    assertEquals(scoped.value.targets.length, 2);
    const unknown = reads.list.handle(opened.snapshot(), userContext(), {
      project: "prj_01arz3ndektsv4rrffq69g5fay",
    });
    assert(unknown.ok);
    assertEquals(unknown.value.targets, []);
    // user가 아닌 자격은 목록을 보지 못한다.
    for (
      const actor of [
        "coding_agent:cac_01arz3ndektsv4rrffq69g5fav",
        "agent:asg_01arz3ndektsv4rrffq69g5fav",
        "app:app_01arz3ndektsv4rrffq69g5fav",
        "machine",
      ]
    ) {
      const rejected = reads.list.handle(
        opened.snapshot(),
        userContext(actor),
        {},
      );
      assert(!rejected.ok, actor);
      assertEquals(rejected.error.code, "forbidden");
    }
  } finally {
    opened.close();
  }
});

Deno.test("documents/file-tracking#R9: files.list는 page 단위로 이어 읽고 cursor 뒤부터 중복 없이 준다", () => {
  const opened = fixture();
  try {
    for (let index = 0; index < 205; index++) {
      document(opened, D(String(index + 1)));
    }
    const first = reads.list.handle(opened.snapshot(), userContext(), {});
    assert(first.ok);
    assertEquals(first.value.targets.length, 200);
    assert(first.value.next_cursor !== null);
    const second = reads.list.handle(opened.snapshot(), userContext(), {
      cursor: first.value.next_cursor,
    });
    assert(second.ok);
    assertEquals(second.value.targets.length, 5);
    assertEquals(second.value.next_cursor, null);
    const seen = new Set(
      [...first.value.targets, ...second.value.targets].map((target) =>
        JSON.stringify(target)
      ),
    );
    assertEquals(seen.size, 205);
  } finally {
    opened.close();
  }
});

Deno.test("documents/file-tracking#R1: working copy 근거는 원본 없는 활성 문서의 연 판 대표 파일이고, 그 밖은 없는 문서와 같은 답이다", () => {
  const opened = fixture();
  try {
    document(opened, D("1"), { versions: 2 });
    document(opened, D("2"), { project: ids.project, path: "/work/a.md" });
    document(opened, D("3"), { status: "archived" });
    const latest = workingCopyCheck(
      opened.snapshot(),
      userContext(),
      "files.write",
      { document: D("1"), base_version: null },
    );
    assert(latest.ok);
    assertEquals(latest.value.eligible, true);
    assertEquals(latest.value.base?.primary_path, "note.md");
    // 최신 판의 대표 파일 hash가 사본이 처음 확정한 내용이다.
    assertEquals(latest.value.base?.confirmed_hash, OTHER);
    assertEquals(latest.value.base?.version, latest.value.latest_version);
    const first = workingCopyCheck(
      opened.snapshot(),
      userContext(),
      "files.write",
      { document: D("1"), base_version: versionId(D("1"), 1) },
    );
    assert(first.ok);
    assertEquals(first.value.base?.confirmed_hash, HASH);
    const absent = workingCopyCheck(
      opened.snapshot(),
      userContext(),
      "files.write",
      { document: D("99"), base_version: null },
    );
    assert(absent.ok);
    for (const document of [D("2"), D("3")]) {
      const same = workingCopyCheck(
        opened.snapshot(),
        userContext(),
        "files.write",
        { document, base_version: null },
      );
      assert(same.ok);
      assertEquals(same.value, absent.value);
    }
    // 다른 문서의 판은 기준이 될 수 없다.
    document(opened, D("4"));
    const foreign = workingCopyCheck(
      opened.snapshot(),
      userContext(),
      "files.write",
      {
        document: D("4"),
        base_version: versionId(D("1"), 1),
      },
    );
    assert(foreign.ok);
    assertEquals(foreign.value, absent.value);
    const agent = workingCopyCheck(
      opened.snapshot(),
      userContext("agent:asg_01arz3ndektsv4rrffq69g5fav"),
      "files.write",
      { document: D("1"), base_version: null },
    );
    assert(!agent.ok);
    assertEquals(agent.error.code, "forbidden");
  } finally {
    opened.close();
  }
});
