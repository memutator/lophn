import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { createVersionCommands } from "./commands.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing/mod.ts";

const commands = createVersionCommands();
const HASH = "ab".repeat(32);

function save(
  fixture: ReturnType<typeof versionFixture>,
  input: ReturnType<typeof preparedInput>,
  actor = userContext(),
  compare: { base_version: string | null } = {
    base_version: input.base_version,
  },
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor, input as never, compare)
  );
}

Deno.test("documents/versions#R1: 첫 저장은 문서와 1번 판을 한 transaction에 만들고 여러 파일을 한 판으로 묶는다", () => {
  const fixture = versionFixture();
  try {
    const files = [
      file("index.html", true, 12, "text/html"),
      file("cover.png", false, 8, "image/png"),
    ];
    const result = keep(save(fixture, preparedInput(ids.doc, files)));
    assertEquals(result.status, "saved");
    const version = fixture.sql.get(
      "SELECT number, primary_path, file_count FROM versions WHERE id = ?",
      [result.version],
    );
    assertEquals(version?.["number"], 1);
    assertEquals(version?.["primary_path"], "index.html");
    assertEquals(version?.["file_count"], 2);
    // 경로별 원문 행은 준비 worker가 파일 목록을 확정하며 남긴다(documents T8).
    // 저장은 정규화 목록 blob 참조를 판에 묶는다.
    const blobs = fixture.blobs.filter((blob) =>
      blob.owner_key === result.version
    );
    assertEquals(blobs.map((blob) => blob.field), ["files"]);
    assertEquals(blobs[0].hash, HASH);
    const types = fixture.emitted.map((event) => event.type);
    assertEquals(types, ["DocumentCreated", "DocumentSaved"]);
    assertEquals(
      (fixture.emitted[1].payload as { previous_version: unknown })
        .previous_version,
      null,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R2: 확정 판의 원문과 저장 주체는 새 판 뒤에도 그대로다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const before = fixture.sql.get("SELECT * FROM versions WHERE id = ?", [
      first.version,
    ]);
    const next = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
    });
    const second = keep(save(fixture, next));
    assert(second.version !== first.version);
    const after = fixture.sql.get("SELECT * FROM versions WHERE id = ?", [
      first.version,
    ]);
    assertEquals(after, before);
    // 판을 고치거나 지우는 길은 trigger가 막는다.
    assertThrowsAbort(() =>
      fixture.sql.run("UPDATE versions SET content_hash = ? WHERE id = ?", [
        "cd".repeat(32),
        first.version,
      ])
    );
    assertThrowsAbort(() =>
      fixture.sql.run("DELETE FROM versions WHERE id = ?", [first.version])
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R3: 같은 내용과 format 계약의 저장은 기존 판을 돌려주고 event가 없다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const again = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      metadata: undefined,
      idempotency_key: "save-2",
    });
    const events = fixture.emitted.length;
    const repeated = keep(save(fixture, again));
    assertEquals(repeated.status, "unchanged");
    assertEquals(repeated.version, first.version);
    assertEquals(repeated.event_seq, null);
    assertEquals(fixture.emitted.length, events);
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 1);
    // 형식 계약만 바꾸면 새 판이 생긴다.
    const changed = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      metadata: undefined,
      idempotency_key: "save-3",
      format: { name: "document", module_hash: HASH, explicit: true },
    });
    const next = keep(save(fixture, changed));
    assertEquals(next.status, "saved");
    const number = fixture.sql.get("SELECT number FROM versions WHERE id = ?", [
      next.version,
    ]);
    assertEquals(number?.["number"], 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R4: 최신 판이 바뀐 뒤의 늦은 저장은 충돌하고 새 판을 덮지 않는다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const winner = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
    });
    keep(save(fixture, winner));
    const late = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      content_hash: "ef".repeat(32),
      metadata: undefined,
      idempotency_key: "save-3",
    });
    const result = save(fixture, late);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R6: 저장 주체와 agent run이 판에 남는다", () => {
  const fixture = versionFixture();
  try {
    const agent = userContext(
      `agent:${ids.run.replace("run_", "asg_")}`,
      ids.run,
    );
    const result = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)]), agent),
    );
    const row = fixture.sql.get(
      "SELECT saved_by, saved_at, run FROM versions WHERE id = ?",
      [result.version],
    );
    assertEquals(row?.["saved_by"], agent.actor);
    assertEquals(row?.["saved_at"], "2026-10-05T00:00:00.000Z");
    assertEquals(row?.["run"], ids.run);
    // run 없는 agent 저장은 거절한다.
    const bare = userContext(`agent:${ids.run.replace("run_", "asg_")}`);
    const rejected = save(
      fixture,
      preparedInput(ids.other, [file("a.md", true)]),
      bare,
    );
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R7: 저장 주체는 인증된 자격이고 주장한 작업 위치는 source가 되지 않는다", () => {
  const fixture = versionFixture();
  try {
    const result = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const row = fixture.sql.get(
      "SELECT saved_by, source FROM versions WHERE id = ?",
      [result.version],
    );
    assertEquals(row?.["saved_by"], "user");
    assertEquals(row?.["source"], null);
    const document = fixture.sql.get(
      "SELECT source_kind FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(document?.["source_kind"], null);
    // 자격과 다른 app 주장을 거절한다.
    const claimed = preparedInput(ids.other, [file("a.md", true)], {
      source: {
        kind: "app",
        app: ids.app,
        release: "rel_01arz3ndektsv4rrffq69g5fav",
      },
    });
    const rejected = save(fixture, claimed);
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R11: 사람은 문서를 보관하고 보관 해제하며 agent의 보관은 거절한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    const agent = userContext(
      `agent:${ids.run.replace("run_", "asg_")}`,
      ids.run,
    );
    const denied = fixture.transaction((tx) =>
      commands.archive.handle(
        tx,
        agent,
        { document: ids.doc },
        { base_revision: "1" },
      )
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { document: ids.doc },
          { base_revision: "1" },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    assertEquals(fixture.emitted.at(-1)?.type, "DocumentArchived");
    // 보관해도 판은 남는다.
    const count = fixture.sql.get("SELECT COUNT(*) AS count FROM versions", []);
    assertEquals(count?.["count"], 1);
    const restored = keep(
      fixture.transaction((tx) =>
        commands.unarchive.handle(
          tx,
          userContext(),
          { document: ids.doc },
          { base_revision: archived.revision },
        )
      ),
    );
    assertEquals(restored.status, "active");
    assertEquals(fixture.emitted.at(-1)?.type, "DocumentUnarchived");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R12: 문서와 판의 영구 삭제는 제공되지 않는다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    assertThrowsAbort(() =>
      fixture.sql.run("DELETE FROM documents WHERE id = ?", [ids.doc])
    );
    const names = Object.keys(commands);
    assert(!names.includes("delete"));
    assert(!names.includes("destroy"));
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: 원본 연결 문서의 직접 내용 저장은 충돌한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    fixture.sql.run(
      `UPDATE documents SET source_kind = ?, source_project = ?, source_path = ?
       WHERE id = ?`,
      ["project_file", ids.project, "/work/notes/a.md", ids.doc],
    );
    const latest = fixture.sql.get(
      "SELECT latest_version FROM documents WHERE id = ?",
      [ids.doc],
    );
    const direct = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: latest?.["latest_version"],
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
    });
    const result = save(fixture, direct);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/file-tracking#R7: 관측 근거가 현재 연결과 다르면 저장은 충돌하고 파일을 다시 읽지 않는다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    fixture.sql.run(
      `UPDATE documents SET source_kind = ?, source_project = ?, source_path = ?
       WHERE id = ?`,
      ["project_file", ids.project, "/work/notes/a.md", ids.doc],
    );
    const latest = fixture.sql.get(
      "SELECT latest_version, revision FROM documents WHERE id = ?",
      [ids.doc],
    );
    const observed = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: latest?.["latest_version"],
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
      source: {
        kind: "file",
        project: ids.project,
        path: "/work/notes/a.md",
        original_hash: "cd".repeat(32),
        observed_at: "2026-10-05T00:00:00.000Z",
      },
      file_basis: {
        kind: "project_file",
        project: ids.project,
        path: "/work/notes/moved.md",
        project_revision: "1",
        document_revision: latest?.["revision"],
        document_status: "active",
        file_source: {
          kind: "project_file",
          project: ids.project,
          path: "/work/notes/moved.md",
        },
        original_hash: "cd".repeat(32),
        observed_at: "2026-10-05T00:00:00.000Z",
      },
    });
    const result = save(fixture, observed);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions",
      [],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R4: 권한 판정이 거절하면 저장하지 않는다", () => {
  const fixture = versionFixture(() =>
    err({ code: "forbidden", message: "대상이 범위 밖이다" })
  );
  try {
    const result = save(fixture, preparedInput(ids.doc, [file("a.md", true)]));
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 0);
  } finally {
    fixture.close();
  }
});

function assertThrowsAbort(run: () => unknown) {
  let thrown = false;
  try {
    run();
  } catch {
    thrown = true;
  }
  assert(thrown);
}

Deno.test("documents/versions#R15: 한 보고를 고치면 그 문서 판이 늘고 최신 판이 따라 간다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    // 같은 문서의 갱신은 새 version으로 쌓인다. 가족 멤버가 늘지 않는다.
    const next = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: first.version,
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
    });
    const second = keep(save(fixture, next));
    assert(second.version !== first.version);
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 2);
    // 문서의 최신 판은 새 version으로 이동한다.
    const document = fixture.sql.get(
      "SELECT latest_version, revision FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(document?.["latest_version"], second.version);
    // 첫 판은 그대로 보존된다.
    const earlier = fixture.sql.get(
      "SELECT content_hash FROM versions WHERE id = ?",
      [
        first.version,
      ],
    );
    assertEquals(earlier?.["content_hash"], HASH);
  } finally {
    fixture.close();
  }
});
