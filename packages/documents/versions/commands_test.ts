import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
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
    // 저장은 정규화 목록 blob 참조와 경로별 원문 blob 참조를 같은 tx에서 판에 묶고
    // 경로별 version_files 행을 남긴다(Q16).
    const blobs = fixture.blobs.filter((blob) =>
      blob.owner_key === result.version
    );
    assertEquals(blobs.map((blob) => blob.field), ["files"]);
    assertEquals(blobs[0].hash, HASH);
    const originals = fixture.blobs.filter((blob) =>
      blob.owner_key.startsWith(`${result.version}/`)
    );
    assertEquals(
      originals.map((blob) => [blob.owner_key, blob.field, blob.hash]),
      [
        [`${result.version}/index.html`, "file", HASH],
        [`${result.version}/cover.png`, "file", HASH],
      ],
    );
    const rows = fixture.sql.all(
      `SELECT path, blob_hash, bytes, media_type, primary_file
       FROM version_files WHERE version = ? ORDER BY path`,
      [result.version],
    );
    assertEquals(
      rows.map((row) => [
        row["path"],
        row["blob_hash"],
        row["bytes"],
        row["media_type"],
        row["primary_file"],
      ]),
      [
        ["cover.png", HASH, 8, "image/png", 0],
        ["index.html", HASH, 12, "text/html", 1],
      ],
    );
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
    const blobsBefore = fixture.blobs.length;
    const repeated = keep(save(fixture, again));
    assertEquals(repeated.status, "unchanged");
    assertEquals(repeated.version, first.version);
    assertEquals(repeated.event_seq, null);
    assertEquals(fixture.emitted.length, events);
    // 같은 내용의 재저장은 blob 참조도 판의 파일 행도 새로 만들지 않는다.
    assertEquals(fixture.blobs.length, blobsBefore);
    const rowCount = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM version_files",
      [],
    );
    assertEquals(rowCount?.["count"], 1);
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

Deno.test("documents/versions#R13: project revision이 바뀌면 관측 저장은 충돌한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    const latest = fixture.sql.get(
      "SELECT latest_version, revision FROM documents WHERE id = ?",
      [ids.doc],
    );
    const observed = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: latest?.["latest_version"],
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-3",
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
        path: "/work/notes/a.md",
        // 관측 때의 문서 판과 다르다. 규칙이 그 사이 바뀐 자리다.
        project_revision: "1",
        document_revision: "999",
        document_status: "active",
        file_source: {
          kind: "project_file",
          project: ids.project,
          path: "/work/notes/a.md",
        },
        original_hash: "cd".repeat(32),
        observed_at: "2026-10-05T00:00:00.000Z",
      },
    });
    const result = save(fixture, observed);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R13: root가 빠져 연결이 없으면 관측 저장은 충돌한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, preparedInput(ids.doc, [file("a.md", true)])));
    const latest = fixture.sql.get(
      "SELECT latest_version, revision FROM documents WHERE id = ?",
      [ids.doc],
    );
    // 문서는 연결이 없는데 제출은 연결을 주장한다. root 제거 뒤의 낡은 제출이다.
    const observed = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: latest?.["latest_version"],
      content_hash: "ef".repeat(32),
      metadata: undefined,
      idempotency_key: "save-4",
      source: {
        kind: "file",
        project: ids.project,
        path: "/work/notes/a.md",
        original_hash: "ef".repeat(32),
        observed_at: "2026-10-05T00:00:00.000Z",
      },
      file_basis: {
        kind: "project_file",
        project: ids.project,
        path: "/work/notes/a.md",
        project_revision: "1",
        document_revision: latest?.["revision"],
        document_status: "active",
        file_source: {
          kind: "project_file",
          project: ids.project,
          path: "/work/notes/a.md",
        },
        original_hash: "ef".repeat(32),
        observed_at: "2026-10-05T00:00:00.000Z",
      },
    });
    const result = save(fixture, observed);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
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

const AT = "2026-10-05T00:00:00.000Z";

// 파일 관측이 만드는 새 문서의 제출. 연결이 없는 새 파일이라 file_source는 null이다.
function newObservation(
  document: string,
  path: string,
  extra: Record<string, unknown> = {},
) {
  return preparedInput(document, [file("a.md", true)], {
    source: {
      kind: "file",
      project: ids.project,
      path,
      original_hash: HASH,
      observed_at: AT,
    },
    file_basis: {
      kind: "project_file",
      project: ids.project,
      path,
      project_revision: "1",
      file_source: null,
      original_hash: HASH,
      observed_at: AT,
    },
    ...extra,
  });
}

Deno.test("documents/versions#R13: 파일 관측의 첫 저장은 문서를 그 파일에 연결하고 DocumentCreated가 연결을 담는다", () => {
  const fixture = versionFixture();
  try {
    const result = keep(
      save(fixture, newObservation(ids.doc, "/work/notes/a.md")),
    );
    assertEquals(result.status, "saved");
    const row = fixture.sql.get(
      "SELECT source_kind, source_project, source_path FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(row?.["source_kind"], "project_file");
    assertEquals(row?.["source_project"], ids.project);
    assertEquals(row?.["source_path"], "/work/notes/a.md");
    const created = fixture.emitted.find((event) =>
      event.type === "DocumentCreated"
    );
    assertEquals(
      (created?.payload as { file_source: unknown }).file_source,
      { kind: "project_file", project: ids.project, path: "/work/notes/a.md" },
    );
    // 연결된 문서의 다음 판은 현재 파일 관측으로만 이어진다.
    const latest = fixture.sql.get(
      "SELECT latest_version, revision FROM documents WHERE id = ?",
      [ids.doc],
    );
    const next = preparedInput(ids.doc, [file("a.md", true)], {
      base_version: latest?.["latest_version"],
      content_hash: "cd".repeat(32),
      metadata: undefined,
      idempotency_key: "save-2",
      source: {
        kind: "file",
        project: ids.project,
        path: "/work/notes/a.md",
        original_hash: "cd".repeat(32),
        observed_at: AT,
      },
      file_basis: {
        kind: "project_file",
        project: ids.project,
        path: "/work/notes/a.md",
        project_revision: "1",
        document_revision: latest?.["revision"],
        document_status: "active",
        file_source: {
          kind: "project_file",
          project: ids.project,
          path: "/work/notes/a.md",
        },
        original_hash: "cd".repeat(32),
        observed_at: AT,
      },
    });
    assertEquals(keep(save(fixture, next)).status, "saved");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R3 documents/file-tracking#R1: 파일 관측이 만든 새 문서는 그 프로젝트에 두고 같은 이름은 -2를 붙이며 자리를 정해 보낸 저장과 파일 없는 저장은 그대로다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, newObservation(ids.doc, "/work/notes/a.md")));
    keep(
      save(
        fixture,
        newObservation(ids.other, "/work/more/a.md", {
          idempotency_key: "save-2",
        }),
      ),
    );
    const placed = fixture.sql.all(
      "SELECT id, place_kind, place_id, name FROM documents ORDER BY name",
      [],
    );
    assertEquals(
      placed.map((row) => [row["place_kind"], row["place_id"], row["name"]]),
      [["project", ids.project, "notes"], ["project", ids.project, "notes-2"]],
    );
    // 두 이름 모두 예약 표에 올라 다른 문서가 쓰지 못한다.
    const reserved = fixture.sql.all(
      "SELECT name FROM document_names ORDER BY name",
      [],
    );
    assertEquals(reserved.map((row) => row["name"]), ["notes", "notes-2"]);
    // 만들어진 event도 자리와 이름을 담는다.
    const created = fixture.emitted.filter((event) =>
      event.type === "DocumentCreated"
    ).map((event) => event.payload as { place: unknown; name: unknown });
    assertEquals(created.map((payload) => payload.name), ["notes", "notes-2"]);
    assertEquals(created[0].place, { kind: "project", id: ids.project });
  } finally {
    fixture.close();
  }

  // 파일 없는 저장은 임의 기본 자리에 넣지 않는다(addressing#R3).
  const plain = versionFixture();
  try {
    keep(save(plain, preparedInput(ids.doc, [file("a.md", true)])));
    const row = plain.sql.get(
      "SELECT place_kind, name FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(row?.["place_kind"], null);
    assertEquals(row?.["name"], null);
  } finally {
    plain.close();
  }

  // 호출자가 자리와 이름을 정해 보낸 관측 저장은 그대로 따른다.
  const named = versionFixture();
  try {
    keep(
      save(
        named,
        newObservation(ids.doc, "/work/notes/a.md", {
          metadata: {
            title: "Notes",
            place: { kind: "project", id: ids.project },
            name: "chosen",
          },
        }),
      ),
    );
    const row = named.sql.get("SELECT name FROM documents WHERE id = ?", [
      ids.doc,
    ]);
    assertEquals(row?.["name"], "chosen");
  } finally {
    named.close();
  }
});

Deno.test("documents/versions#R13: 같은 경로에 이미 연결된 문서가 있으면 새 문서 저장은 충돌한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, newObservation(ids.doc, "/work/notes/a.md")));
    const again = save(
      fixture,
      newObservation(ids.other, "/work/notes/a.md", {
        idempotency_key: "save-2",
      }),
    );
    assert(!again.ok);
    assertEquals(again.error.code, "conflict");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/file-tracking#R7: 새 문서 제출이 이미 있는 연결을 주장하면 낡은 제출이라 충돌한다", () => {
  const fixture = versionFixture();
  try {
    const stale = newObservation(ids.doc, "/work/notes/a.md");
    const basis = (stale as { file_basis?: unknown }).file_basis as Record<
      string,
      unknown
    >;
    basis.file_source = {
      kind: "project_file",
      project: ids.project,
      path: "/work/notes/a.md",
    };
    basis.document_revision = "9";
    basis.document_status = "active";
    const result = save(fixture, stale);
    assert(!result.ok);
    assertEquals(result.error.code, "conflict");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 0);
  } finally {
    fixture.close();
  }
});

// 이미 등록된 원문 blob을 새 판의 파일로 다시 묶는 입력(옛 내용으로 되돌림, 같은 바이트).
function existingFile(
  version: string,
  path: string,
  overrides: Record<string, unknown> = {},
) {
  const { content: _content, preparation_ref: _ref, ...plain } = file(
    path,
    true,
  );
  return {
    ...plain,
    existing: {
      owner_kind: "document_version",
      owner_key: `${version}/${path}`,
      field: "file",
      hash: HASH,
      registered_seq: "1",
    },
    ...overrides,
  };
}

function secondVersion(
  base: string,
  files: unknown[],
  key = "save-2",
  extra: Record<string, unknown> = {},
) {
  return {
    ...preparedInput(ids.doc, [file("a.md", true)]),
    base_version: base,
    metadata: undefined,
    idempotency_key: key,
    content_hash: "cd".repeat(32),
    files,
    ...extra,
  } as unknown as ReturnType<typeof preparedInput>;
}

Deno.test("documents/versions#R5: 이미 등록된 원문 blob은 같은 tx에서 새 판의 경로에 다시 묶인다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const reused = keep(
      save(
        fixture,
        secondVersion(first.version, [existingFile(first.version, "a.md")]),
      ),
    );
    assertEquals(reused.status, "saved");
    const rows = fixture.sql.all(
      "SELECT path, blob_hash, bytes FROM version_files WHERE version = ?",
      [reused.version],
    );
    assertEquals(rows.map((row) => [row["path"], row["blob_hash"]]), [[
      "a.md",
      HASH,
    ]]);
    assertEquals(
      fixture.blobs.filter((blob) =>
        blob.owner_key === `${reused.version}/a.md`
      ).map((blob) => [blob.field, blob.hash]),
      [["file", HASH]],
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R5: 없는 기존 참조와 권한 밖 참조는 같은 답이고 아무것도 남기지 않는다", () => {
  const denyFile = versionFixture((_ctx, operation) =>
    operation === "document.file"
      ? err({ code: "forbidden", message: "범위 밖" })
      : ok(undefined)
  );
  const open = versionFixture();
  try {
    const answers: unknown[] = [];
    for (const fixture of [denyFile, open]) {
      const first = keep(
        save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
      );
      const before = fixture.blobs.length;
      const target = fixture === denyFile
        ? existingFile(first.version, "a.md") // 있지만 권한 밖
        : existingFile("ver_01arz3ndektsv4rrffq69g5fb9", "a.md"); // 없음
      const rejected = save(fixture, secondVersion(first.version, [target]));
      assert(!rejected.ok);
      answers.push(rejected.error);
      assertEquals(fixture.blobs.length, before);
      assertEquals(
        fixture.sql.get("SELECT COUNT(*) AS count FROM versions", [])?.[
          "count"
        ],
        1,
      );
    }
    assertEquals(answers[0], answers[1]);
    // 판 파일 참조가 아닌 blob(목록 blob 등)이나 다른 크기를 가리키는 참조도 같은 답이다.
    const first = keep(
      save(open, preparedInput(ids.other, [file("a.md", true)])),
    );
    for (
      const bad of [
        existingFile(first.version, "a.md", {
          existing: {
            owner_kind: "document_version",
            owner_key: first.version,
            field: "files",
            hash: HASH,
            registered_seq: "1",
          },
        }),
        existingFile(first.version, "a.md", { bytes: 99 }),
      ]
    ) {
      const result = save(
        open,
        secondVersion(first.version, [bad], "save-9", { document: ids.other }),
      );
      assert(!result.ok);
      assertEquals(result.error, answers[0]);
    }
  } finally {
    denyFile.close();
    open.close();
  }
});
