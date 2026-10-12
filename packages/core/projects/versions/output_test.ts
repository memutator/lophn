// documents/versions#R14: agent 출력의 저장 범위와 revert가 쓰는 보상 경로.
// agent 자격의 저장은 고정 판으로 남고 SaveResult의 고정 참조로 다시 열린다. 원본 연결·보관
// 문서와 파일 source 주장은 출력이 아니다. revert의 machine은 agent가 만든 문서의 보관과
// 판 restore만 한다.
import { assert, assertEquals } from "@std/assert";
import { createVersionCommands } from "./commands.ts";
import { createVersionReads } from "./reads.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing/mod.ts";

const commands = createVersionCommands();
const reads = createVersionReads();
const HASH = "ab".repeat(32);
const OTHER_HASH = "cd".repeat(32);
const AT = "2026-10-05T00:00:00.000Z";
const agent = () =>
  userContext(`agent:${ids.run.replace("run_", "asg_")}`, ids.run);

type Fixture = ReturnType<typeof versionFixture>;

function save(
  fixture: Fixture,
  input: ReturnType<typeof preparedInput>,
  actor = agent(),
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor, input as never, {
      base_version: input.base_version,
    })
  );
}

function update(
  fixture: Fixture,
  base: string,
  document: string,
  key: string,
  actor = agent(),
  hash = OTHER_HASH,
) {
  return save(
    fixture,
    preparedInput(document, [file("a.md", true)], {
      base_version: base,
      content_hash: hash,
      metadata: undefined,
      idempotency_key: key,
    }),
    actor,
  );
}

function revisionOf(fixture: Fixture, document = ids.doc): string {
  const row = fixture.sql.get("SELECT revision FROM documents WHERE id = ?", [
    document,
  ]);
  return String(row?.["revision"]);
}

function archive(
  fixture: Fixture,
  actor: ReturnType<typeof userContext>,
  base: string,
) {
  return fixture.transaction((tx) =>
    commands.archive.handle(
      tx,
      actor,
      { document: ids.doc },
      { base_revision: base },
    )
  );
}

function link(fixture: Fixture) {
  fixture.sql.run(
    `UPDATE documents SET source_kind = 'project_file', source_project = ?,
       source_path = '/work/a.md' WHERE id = ?`,
    [ids.project, ids.doc],
  );
}

Deno.test("documents/versions#R14: agent 출력은 고정 판으로 남고 SaveResult의 고정 참조로 다시 열린다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    assertEquals(first.status, "saved");
    assertEquals(first.reference, {
      document: ids.doc,
      version: first.version,
      section: null,
    });
    const second = keep(update(fixture, first.version, ids.doc, "save-2"));
    assert(second.version !== first.version);
    // 두 판 모두 참조로 다시 열린다. 옛 판은 새 판 뒤에도 그대로다.
    for (const saved of [first, second]) {
      const opened = keep(
        reads.get.handle(
          fixture.snapshot() as never,
          userContext(),
          { document: ids.doc, version: saved.version },
        ),
      );
      assertEquals(opened.reference, saved.reference);
      assertEquals(opened.version.id, saved.version);
      assertEquals(opened.version.saved_by, agent().actor);
      assertEquals(opened.version.run, ids.run);
    }
    // 결과가 같은 저장은 새 판을 만들지 않는다.
    const again = keep(
      save(
        fixture,
        preparedInput(ids.doc, [file("a.md", true)], {
          base_version: second.version,
          content_hash: OTHER_HASH,
          metadata: undefined,
          idempotency_key: "save-3",
        }),
      ),
    );
    assertEquals(again.status, "unchanged");
    assertEquals(again.version, second.version);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: agent는 파일 관측이나 앱 source를 주장하지 못한다", () => {
  const fixture = versionFixture();
  try {
    const sources = [
      {
        kind: "file",
        project: ids.project,
        path: "/work/a.md",
        original_hash: HASH,
        observed_at: AT,
      },
      {
        kind: "app",
        app: ids.app,
        release: "rel_01arz3ndektsv4rrffq69g5fav",
      },
    ];
    for (const source of sources) {
      const rejected = save(
        fixture,
        preparedInput(ids.doc, [file("a.md", true)], { source }),
      );
      assert(!rejected.ok, source.kind);
      assertEquals(rejected.error.code, "forbidden", source.kind);
    }
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM documents",
      [],
    );
    assertEquals(count?.["count"], 0);
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 원본 연결 문서와 보관 문서는 agent 출력이 아니고 제목도 못 바꾼다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const titled = (base: string) =>
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          agent(),
          { document: ids.doc, title: "새 제목" },
          { base_revision: base },
        )
      );
    // 보관한 문서. 사람의 보관 뒤 agent 저장은 forbidden이고 판은 늘지 않는다.
    const archived = keep(archive(fixture, userContext(), revisionOf(fixture)));
    const events = fixture.emitted.length;
    const onArchived = update(fixture, first.version, ids.doc, "save-2");
    assert(!onArchived.ok);
    assertEquals(onArchived.error.code, "forbidden");
    const retitledArchived = titled(archived.revision);
    assert(!retitledArchived.ok);
    assertEquals(retitledArchived.error.code, "forbidden");
    // 원본 연결 문서.
    fixture.sql.run("UPDATE documents SET status = 'active' WHERE id = ?", [
      ids.doc,
    ]);
    link(fixture);
    const onLinked = update(fixture, first.version, ids.doc, "save-3");
    assert(!onLinked.ok);
    assertEquals(onLinked.error.code, "forbidden");
    const retitledLinked = titled(revisionOf(fixture));
    assert(!retitledLinked.ok);
    assertEquals(retitledLinked.error.code, "forbidden");
    assertEquals(fixture.emitted.length, events);
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 지침 파일 문서는 agent 출력 대상이 아니다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    fixture.sql.run(
      `UPDATE documents SET source_kind = 'instruction_file',
         source_instruction_target = 'ins-target', source_project = NULL,
         source_path = '/home/me/LOPHN.md' WHERE id = ?`,
      [ids.doc],
    );
    const rejected = update(fixture, first.version, ids.doc, "save-2");
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "forbidden");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 범위 밖 문서의 agent 저장은 platform 판정 그대로 거절된다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    fixture.use(() => ({
      ok: false,
      error: { code: "forbidden", message: "범위 밖" },
    }));
    const rejected = update(fixture, first.version, ids.doc, "save-2");
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "forbidden");
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: revert의 machine은 agent가 만든 문서만 보관하고 판은 그대로 남는다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    keep(update(fixture, first.version, ids.doc, "save-2"));
    const base = revisionOf(fixture);
    // 낡은 revision은 conflict다. 이후 변경은 보상하지 않는다.
    const stale = archive(fixture, userContext("machine"), "0");
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const archived = keep(archive(fixture, userContext("machine"), base));
    assertEquals(archived.status, "archived");
    assertEquals(fixture.emitted.at(-1)?.type, "DocumentArchived");
    // 판은 하나도 지우지 않는다.
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM versions WHERE document = ?",
      [ids.doc],
    );
    assertEquals(count?.["count"], 2);
    // 다시 보관하는 보상은 한 번만 된다.
    const twice = archive(
      fixture,
      userContext("machine"),
      archived.revision,
    );
    assert(!twice.ok);
    assertEquals(twice.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: revert의 보관은 사람이 만든 문서와 원본 연결 문서를 보상하지 않고 이후 다른 주체의 판은 conflict다", () => {
  const fixture = versionFixture();
  try {
    // 사람이 만든 문서.
    const made = keep(
      save(
        fixture,
        preparedInput(ids.doc, [file("a.md", true)]),
        userContext(),
      ),
    );
    const human = archive(fixture, userContext("machine"), revisionOf(fixture));
    assert(!human.ok);
    assertEquals(human.error.code, "forbidden");
    assertEquals(
      fixture.sql.get("SELECT status FROM documents WHERE id = ?", [ids.doc])
        ?.["status"],
      "active",
    );
    // agent가 만들었지만 이후 사람이 판을 더한 문서.
    const created = keep(
      save(fixture, preparedInput(ids.other, [file("a.md", true)])),
    );
    keep(
      update(fixture, created.version, ids.other, "save-2", userContext()),
    );
    const later = fixture.transaction((tx) =>
      commands.archive.handle(
        tx,
        userContext("machine"),
        { document: ids.other },
        { base_revision: revisionOf(fixture, ids.other) },
      )
    );
    assert(!later.ok);
    assertEquals(later.error.code, "conflict");
    // 원본 연결 문서는 agent가 만들 수 없지만 뒤에 연결돼도 revert가 건드리지 않는다.
    link(fixture);
    const linked = archive(
      fixture,
      userContext("machine"),
      revisionOf(fixture),
    );
    assert(!linked.ok);
    assertEquals(linked.error.code, "forbidden");
    assertEquals(made.status, "saved");
    // 사람의 보관은 그대로 된다.
    const manual = keep(archive(fixture, userContext(), revisionOf(fixture)));
    assertEquals(manual.status, "archived");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: revert의 machine restore는 이후 판·revision이 그대로일 때만 새 판을 만들고 옛 판을 남긴다", () => {
  const fixture = versionFixture();
  try {
    const first = keep(
      save(fixture, preparedInput(ids.doc, [file("a.md", true)])),
    );
    const second = keep(update(fixture, first.version, ids.doc, "save-2"));
    const restoreInput = (base: string, key: string) => ({
      document: ids.doc,
      restore_version: first.version,
      prepared: preparedInput(ids.doc, [file("a.md", true)], {
        base_version: base,
        content_hash: HASH,
        metadata: undefined,
        idempotency_key: key,
      }),
    });
    const run = (base: string, revision: string, key: string) =>
      fixture.transaction((tx) =>
        commands.restore.handle(
          tx,
          userContext("machine"),
          restoreInput(base, key) as never,
          { base_version: base, base_revision: revision },
        )
      );
    // 사람이 그 사이 판을 더했다면 run 이후 판이 그대로가 아니라서 conflict다.
    const human = keep(
      update(
        fixture,
        second.version,
        ids.doc,
        "human",
        userContext(),
        "ef".repeat(32),
      ),
    );
    assertEquals(human.status, "saved");
    const stale = run(second.version, revisionOf(fixture), "r-stale");
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const latest = human.version;
    const restored = keep(run(latest, revisionOf(fixture), "r-ok"));
    assertEquals(restored.status, "saved");
    assertEquals(
      fixture.emitted.slice(-2).map((event) => event.type),
      ["DocumentSaved", "DocumentRestored"],
    );
    // 옛 판과 agent의 판은 남고 새 판이 뒤에 쌓인다.
    const rows = fixture.sql.all(
      "SELECT id FROM versions WHERE document = ? ORDER BY number",
      [ids.doc],
    );
    assertEquals(rows.length, 4);
    assert(rows.some((row) => row["id"] === first.version));
    assert(rows.some((row) => row["id"] === second.version));
  } finally {
    fixture.close();
  }
});
