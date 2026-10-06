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
const AGENT = "agent:asg_01arz3ndektsv4rrffq69g5fav";
const CODING = "coding_agent:cac_01arz3ndektsv4rrffq69g5fav";
const APP = `app:${ids.app}`;
const NON_HUMAN = [AGENT, CODING, APP];
const AT = "2026-10-06T00:00:00.000Z";
const HASH = "cd".repeat(32);
const PATH = "/home/p/.lophn/LOPHN.md";

function save(
  fixture: ReturnType<typeof versionFixture>,
  input: ReturnType<typeof preparedInput>,
  actor: ReturnType<typeof userContext> = userContext(),
  base: string | null = input.base_version,
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor, input as never, { base_version: base })
  );
}

function update(
  fixture: ReturnType<typeof versionFixture>,
  actor: string,
  revision: string,
) {
  return fixture.transaction((tx) =>
    commands.update.handle(
      tx,
      userContext(actor),
      { document: ids.doc, title: "Changed" } as never,
      { base_revision: revision },
    )
  );
}

function revisionOf(fixture: ReturnType<typeof versionFixture>): string {
  return String(
    fixture.sql.get("SELECT revision FROM documents WHERE id = ?", [ids.doc])
      ?.["revision"],
  );
}

function attached() {
  return {
    attachments: (document: string) =>
      document === ids.doc
        ? ok([{ preset: "pst_01arz3ndektsv4rrffq69g5fav", revision: 1 }])
        : ok([]),
  };
}

// 전역 지침 파일을 관측한 판. place·name은 null이고 project도 null이다.
function observedInput(
  fixture: ReturnType<typeof versionFixture>,
  extra: Record<string, unknown> = {},
  target = "global",
) {
  const latest = fixture.sql.get(
    "SELECT latest_version, revision FROM documents WHERE id = ?",
    [ids.doc],
  );
  const existing = latest !== undefined;
  const source = {
    kind: "instruction_file",
    instruction_target: target,
    project: null,
    path: PATH,
    original_hash: HASH,
    observed_at: AT,
  };
  return preparedInput(ids.doc, [file("LOPHN.md", true, 8, "text/markdown")], {
    base_version: existing ? latest["latest_version"] : null,
    ...(existing ? { metadata: undefined } : {}),
    content_hash: existing ? "ef".repeat(32) : HASH,
    idempotency_key: existing ? "obs-2" : "obs-1",
    source,
    file_basis: {
      kind: "instruction_file",
      instruction_target: target,
      project: null,
      path: PATH,
      instruction_revision: "1",
      project_revision: null,
      file_source: existing
        ? {
          kind: "instruction_file",
          instruction_target: target,
          project: null,
          path: PATH,
        }
        : null,
      ...(existing
        ? { document_revision: latest["revision"], document_status: "active" }
        : {}),
      original_hash: HASH,
      observed_at: AT,
    },
    ...extra,
  });
}

Deno.test("documents/file-tracking#R19 documents/versions#R19: 전역 지침 파일의 첫 관측은 place·name 없는 instruction_file 문서와 첫 판을 만들고 Project를 만들지 않는다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, observedInput(fixture), userContext("machine")));
    const row = fixture.sql.get(
      `SELECT place_kind, place_id, name, source_kind, source_instruction_target,
              source_project, source_path FROM documents WHERE id = ?`,
      [ids.doc],
    );
    assertEquals(row?.["place_kind"], null);
    assertEquals(row?.["place_id"], null);
    assertEquals(row?.["name"], null);
    assertEquals(row?.["source_kind"], "instruction_file");
    assertEquals(row?.["source_instruction_target"], "global");
    assertEquals(row?.["source_project"], null);
    assertEquals(row?.["source_path"], PATH);
    // 두 번째 관측(외부 편집)은 같은 문서의 새 판이다. 과거 판은 덮지 않는다.
    const next = keep(save(
      fixture,
      observedInput(fixture),
      userContext("machine"),
    ));
    assert(next.version !== undefined);
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM versions", [])?.["count"],
      2,
    );
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM documents", [])?.["count"],
      1,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/file-tracking#R19: 같은 지침 파일을 두 번째 문서로 연결하지 않고 다른 대상의 관측 제출은 충돌한다", () => {
  const fixture = versionFixture();
  try {
    keep(save(fixture, observedInput(fixture), userContext("machine")));
    // 같은 실제 파일로 새 문서를 만들려 한다.
    const other = observedInput(fixture, {
      document: ids.other,
      base_version: null,
      metadata: { title: "again", place: null, name: null },
      file_basis: {
        kind: "instruction_file",
        instruction_target: "global",
        project: null,
        path: PATH,
        instruction_revision: "1",
        project_revision: null,
        file_source: null,
        original_hash: HASH,
        observed_at: AT,
      },
    });
    const duplicate = save(fixture, other, userContext("machine"));
    assert(!duplicate.ok);
    assertEquals(duplicate.error.code, "conflict");
    // 연결된 문서에 다른 등록 대상의 제출이 오면 그 제출은 늦은 것이다.
    const stale = save(
      fixture,
      observedInput(fixture, {}, "project:prj_01arz3ndektsv4rrffq69g5fav"),
      userContext("machine"),
    );
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM documents", [])?.["count"],
      1,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R20 documents/file-tracking#R20: preset 지침 첨부 문서의 agent·coding_agent·app save는 forbidden이고 user는 허용한다", () => {
  const fixture = versionFixture(undefined, attached());
  try {
    const created = keep(save(
      fixture,
      preparedInput(ids.doc, [file("LOPHN.md", true, 100)]),
    ));
    const base = created.version;
    for (
      const actor of NON_HUMAN
    ) {
      const result = save(
        fixture,
        preparedInput(ids.doc, [file("LOPHN.md", true, 101)], {
          base_version: base,
          source: actor === APP
            ? {
              kind: "app",
              app: ids.app,
              release: "rel_01arz3ndektsv4rrffq69g5fav",
            }
            : null,
        }),
        userContext(actor),
        base,
      );
      assert(!result.ok, actor);
      assertEquals(result.error.code, "forbidden", actor);
    }
    const human = save(
      fixture,
      preparedInput(ids.doc, [file("LOPHN.md", true, 101)], {
        base_version: base,
        content_hash: "ef".repeat(32),
        metadata: undefined,
        idempotency_key: "save-2",
      }),
      userContext(),
      base,
    );
    assert(human.ok, JSON.stringify(human));
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R20: 지침 첨부 문서의 제목 변경도 agent·coding_agent·app에 forbidden이고 user는 허용한다", () => {
  const fixture = versionFixture(undefined, attached());
  try {
    keep(save(
      fixture,
      preparedInput(ids.doc, [file("LOPHN.md", true, 100)]),
    ));
    const revision = revisionOf(fixture);
    for (
      const actor of NON_HUMAN
    ) {
      const result = update(fixture, actor, revision);
      assert(!result.ok, actor);
      assertEquals(result.error.code, "forbidden", actor);
    }
    assert(update(fixture, "user", revision).ok);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/file-tracking#R20 documents/versions#R20: instruction_file에 연결된 문서는 첨부가 없어도 agent·coding_agent·app가 못 쓰고 다른 출력으로 지정해도 풀리지 않는다", () => {
  const output = {
    output: () =>
      ok({
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        revision: 1,
        state: "enabled" as const,
      }),
  };
  const fixture = versionFixture(undefined, undefined, output);
  try {
    const created = keep(save(
      fixture,
      observedInput(fixture),
      userContext("machine"),
    ));
    const base = created.version;
    for (
      const actor of NON_HUMAN
    ) {
      const saved = save(
        fixture,
        preparedInput(ids.doc, [file("LOPHN.md", true, 101)], {
          base_version: base,
          content_hash: "ef".repeat(32),
          metadata: undefined,
          idempotency_key: "save-3",
        }),
        userContext(actor),
        base,
      );
      assert(!saved.ok, actor);
      assertEquals(saved.error.code, "forbidden", actor);
      const renamed = update(fixture, actor, revisionOf(fixture));
      assert(!renamed.ok, actor);
      assertEquals(renamed.error.code, "forbidden", actor);
    }
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM versions", [])?.["count"],
      1,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R20: agent·coding_agent·app는 instruction_file 원본으로 문서를 만들지 못한다", () => {
  const fixture = versionFixture();
  try {
    for (
      const actor of NON_HUMAN
    ) {
      const result = save(fixture, observedInput(fixture), userContext(actor));
      assert(!result.ok, actor);
      assertEquals(result.error.code, "forbidden", actor);
    }
    assertEquals(
      fixture.sql.get("SELECT COUNT(*) AS count FROM documents", [])?.["count"],
      0,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R20: 첨부가 가리키는 새 문서 id를 agent가 만들 수 없고 판정 port가 실패하면 쓰기를 거절한다", () => {
  const attachedNew = versionFixture(undefined, attached());
  try {
    const created = save(
      attachedNew,
      preparedInput(ids.doc, [file("LOPHN.md", true, 100)]),
      userContext(AGENT),
    );
    assert(!created.ok);
    assertEquals(created.error.code, "forbidden");
  } finally {
    attachedNew.close();
  }
  const broken = versionFixture(undefined, {
    attachments: () => err({ code: "unavailable", message: "lookup failed" }),
  });
  try {
    const result = save(
      broken,
      preparedInput(ids.doc, [file("note.md", true, 100)]),
      userContext(AGENT),
    );
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
  } finally {
    broken.close();
  }
});
