import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { documentExport } from "../../contracts/documents/mod.ts";
import { createVersionCommands } from "./commands.ts";
import { createVersionReads, exportDocument, storedFile } from "./reads.ts";
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

function save(fixture: ReturnType<typeof versionFixture>, key: string) {
  const input = preparedInput(ids.doc, [file("a.md", true)], {
    idempotency_key: key,
  });
  return keep(
    fixture.transaction((tx) =>
      commands.save.handle(tx, userContext(), input as never, {
        base_version: null,
      })
    ),
  );
}

// documents.versions 표의 CHECK를 따르는 사람 자리 문서 행. place·name은 자리
// 검사에 필요하다. 문서 임시 latest_version은 판 insert 뒤 옮긴다.
const VER = "ver_01arz3ndektsv4rrffq69g5fav";

function placedFixture(
  fixture: ReturnType<typeof versionFixture>,
): { version: string } {
  fixture.sql.run(
    `INSERT INTO documents (id, place_kind, place_id, name, title, latest_version, revision, status)
     VALUES (?, 'project', ?, 'report', '보고서', ?, '1', 'active')`,
    [ids.doc, ids.project, VER],
  );
  fixture.sql.run(
    `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
       content_hash, format_name, module_hash, format_explicit, saved_by, saved_at, run, source)
     VALUES (?, ?, 1, ?, 'a.md', 1, ?, 'document', ?, 0, 'user',
       '2026-10-05T00:00:00.000Z', NULL, NULL)`,
    [VER, ids.doc, "ab".repeat(32), "ab".repeat(32), "ab".repeat(32)],
  );
  fixture.sql.run(
    `UPDATE documents SET latest_version = ? WHERE id = ?`,
    [VER, ids.doc],
  );
  return { version: VER };
}

Deno.test("documents/versions#R8: 목록은 자리·상태·개수로 거르고 최신 판의 주체·시각·format을 담는다", () => {
  const fixture = versionFixture();
  try {
    const saved = save(fixture, "save-1");
    const page = keep(
      reads.list.handle(
        fixture.snapshot() as never,
        userContext(),
        { status: "active", limit: 10 },
      ),
    );
    assertEquals(page.documents.length, 1);
    const entry = page.documents[0];
    assertEquals(entry.document.id, ids.doc);
    assertEquals(entry.latest_version.id, saved.version);
    assertEquals(entry.latest_version.saved_by, "user");
    assertEquals(entry.latest_version.saved_at, "2026-10-05T00:00:00.000Z");
    assertEquals(entry.latest_version.format.name, "document");
    assertEquals("files" in entry.latest_version, false);
    assertEquals(page.next_cursor, null);
    const archived = reads.list.handle(
      fixture.snapshot() as never,
      userContext(),
      { status: "archived" },
    );
    assert(archived.ok);
    assertEquals(archived.value.documents.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R8: get은 지정 판과 고정 참조를 돌려주고 없는 문서는 not_found다", () => {
  const fixture = versionFixture();
  try {
    const saved = save(fixture, "save-1");
    const got = keep(
      reads.get.handle(
        fixture.snapshot() as never,
        userContext(),
        { document: ids.doc },
      ),
    );
    assertEquals(got.version.id, saved.version);
    assertEquals(got.reference, {
      document: ids.doc,
      version: saved.version,
      section: null,
    });
    const missing = reads.get.handle(
      fixture.snapshot() as never,
      userContext(),
      { document: ids.other },
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R8: history는 판마다 주체·시각·run을 담는다", () => {
  const fixture = versionFixture();
  try {
    const agent = userContext(
      `agent:${ids.run.replace("run_", "asg_")}`,
      ids.run,
    );
    const first = preparedInput(ids.doc, [file("a.md", true)]);
    const saved = keep(
      fixture.transaction((tx) =>
        commands.save.handle(tx, agent, first as never, { base_version: null })
      ),
    );
    const page = keep(
      reads.history.handle(
        fixture.snapshot() as never,
        userContext(),
        { document: ids.doc },
      ),
    );
    assertEquals(page.versions.length, 1);
    assertEquals(page.versions[0].saved_by, agent.actor);
    assertEquals(page.versions[0].run, ids.run);
    assertEquals(page.complete, true);
    assertEquals(page.next_cursor, null);
    assert(saved.version === page.versions[0].id);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R9: 권한 밖 문서의 read는 없는 것으로 돌려준다", () => {
  const fixture = versionFixture();
  try {
    save(fixture, "save-1");
    fixture.use(() =>
      err({ code: "forbidden", message: "대상이 범위 밖이다" })
    );
    const listed = keep(
      reads.list.handle(fixture.snapshot() as never, userContext(), {}),
    );
    assertEquals(listed.documents.length, 0);
    const got = reads.get.handle(
      fixture.snapshot() as never,
      userContext(),
      { document: ids.doc },
    );
    assert(!got.ok);
    assertEquals(got.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R9: file read는 고정 판의 상대 경로를 저장 바이트와 MIME으로 연다", () => {
  const fixture = versionFixture();
  try {
    const saved = save(fixture, "save-1");
    // 경로별 원문 행은 준비 worker가 남긴다(documents T8). 여기선 그 결과를 심는다.
    fixture.sql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [saved.version, "a.md", "ab".repeat(32), 4, "text/plain", 1],
    );
    const opened = keep(
      storedFile(fixture.snapshot() as never, userContext(), {
        version: saved.version,
        path: "a.md",
      }),
    );
    assertEquals(opened.media_type, "text/plain");
    assertEquals(opened.bytes, 4);
    const missing = storedFile(fixture.snapshot() as never, userContext(), {
      version: saved.version,
      path: "missing.md",
    });
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

// documents/versions#R16: export는 고른 자리 문서와 고정 판을 Markdown·JSON으로,
// 원래 바이트 참조와 판 참조를 함께 돌려준다. derived는 다시 만든다.
type ExportEntry = {
  document: { id: string };
  version: { id: string; number: number; files: unknown };
  reference: unknown;
};
type ExportPage = {
  format: "markdown" | "json";
  documents: ExportEntry[];
};

function cast(result: unknown): { ok: true; value: ExportPage } {
  return result as { ok: true; value: ExportPage };
}

Deno.test("documents/versions#R16: export는 고른 자리 문서의 고정 판을 원래 바이트·판 참조로 묶는다", () => {
  const fixture = versionFixture();
  try {
    const placed = placedFixture(fixture);
    // 원래 바이트는 version_files의 상대 경로 행이다(documents T8 준비 worker 몫).
    fixture.sql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, 'a.md', ?, 4, 'text/markdown', 1)`,
      [placed.version, "ab".repeat(32)],
    );
    const page = keep(
      cast(
        exportDocument(
          fixture.snapshot() as never,
          userContext(),
          {
            place: { kind: "project", id: ids.project },
            documents: [{ document: ids.doc, version: placed.version }],
            format: "markdown",
          },
          { redactor: (_source, _mediaType, text) => text },
        ),
      ),
    );
    assertEquals(page.format, "markdown");
    assertEquals(page.documents.length, 1);
    const entry = page.documents[0];
    assertEquals(entry.document.id, ids.doc);
    // 디스크 file_source는 출력에서 뺀다(agentDocumentSchema).
    assertEquals("file_source" in entry.document, false);
    assertEquals(entry.version.id, placed.version);
    assertEquals(entry.version.number, 1);
    // 원래 바이트는 상대 경로·hash·원래 MIME·바이트 수로 남는다.
    assertEquals(entry.version.files, [{
      path: "a.md",
      blob_hash: "ab".repeat(32),
      bytes: 4,
      media_type: "text/markdown",
      primary: true,
    }]);
    // 판 참조는 문서 ID와 판 ID다.
    assertEquals(entry.reference, {
      document: ids.doc,
      version: placed.version,
      section: null,
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R16: export 계약은 사람만 받고 HTML·PDF 같은 원문은 원래 MIME로 남는다", () => {
  const fixture = versionFixture();
  try {
    const placed = placedFixture(fixture);
    fixture.sql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, 'page.html', ?, 9, 'text/html', 1)`,
      [placed.version, "ab".repeat(32)],
    );
    // worker route의 등록 actor가 ["user"]라는 것을 계약으로 본다.
    assertEquals(documentExport.actors, ["user"]);
    const opened = keep(
      cast(
        exportDocument(
          fixture.snapshot() as never,
          userContext(),
          {
            place: { kind: "project", id: ids.project },
            documents: [{ document: ids.doc, version: placed.version }],
            format: "json",
          },
          { redactor: (_source, _mediaType, text) => text },
        ),
      ),
    );
    assertEquals(opened.format, "json");
    assertEquals(opened.documents[0].version.files, [{
      path: "page.html",
      blob_hash: "ab".repeat(32),
      bytes: 9,
      media_type: "text/html",
      primary: true,
    }]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R16: agent actor의 export는 forbidden이고 권한 밖·없는 문서는 같은 not_found다", () => {
  const fixture = versionFixture();
  try {
    const placed = placedFixture(fixture);
    // worker route의 actor 검사는 agent 자격을 거부한다.
    const agent = exportDocument(
      fixture.snapshot() as never,
      { ...userContext(), actor: "agent:asg_01arz3ndektsv4rrffq69g5fav" },
      {
        place: { kind: "project", id: ids.project },
        documents: [{ document: ids.doc, version: placed.version }],
        format: "markdown",
      },
    );
    assert(!agent.ok);
    assertEquals(agent.error.code, "forbidden");
    fixture.use(() =>
      err({ code: "forbidden", message: "대상이 범위 밖이다" })
    );
    const hidden = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      {
        place: { kind: "project", id: ids.project },
        documents: [{ document: ids.doc, version: placed.version }],
        format: "markdown",
      },
    );
    assert(!hidden.ok);
    assertEquals(hidden.error.code, "not_found");
    const missing = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      {
        place: { kind: "project", id: ids.project },
        documents: [{ document: ids.other, version: placed.version }],
        format: "markdown",
      },
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R16: 자리가 바뀐 문서의 export는 conflict이고 고른 자리 밖 문서도 conflict다", () => {
  const fixture = versionFixture();
  try {
    const placed = placedFixture(fixture);
    const appPlace = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      {
        place: { kind: "app", id: ids.app },
        documents: [{ document: ids.doc, version: placed.version }],
        format: "markdown",
      },
    );
    assert(!appPlace.ok);
    assertEquals(appPlace.error.code, "conflict");
    // 판 ID가 다른 문서의 판이면 not_found다.
    const wrongVersion = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      {
        place: { kind: "project", id: ids.project },
        documents: [{ document: ids.doc, version: ids.other }],
        format: "markdown",
      },
    );
    assert(!wrongVersion.ok);
    assertEquals(wrongVersion.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R16: redactor가 없거나 실패한 export는 내보내지 않는다", () => {
  const fixture = versionFixture();
  try {
    const placed = placedFixture(fixture);
    fixture.sql.run(
      `INSERT INTO version_files (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, 'a.md', ?, 4, 'text/markdown', 1)`,
      [placed.version, "ab".repeat(32)],
    );
    const input = {
      place: { kind: "project", id: ids.project },
      documents: [{ document: ids.doc, version: placed.version }],
      format: "markdown",
    } as const;
    // redactor 조립이 없는 export도 온전한 export로 꾸미지 않는다(fail-closed다).
    const noRedactor = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      input,
    );
    assert(!noRedactor.ok);
    assertEquals(noRedactor.error.code, "unavailable");
    // redaction 실패는 해당 원문 반환을 중단하고 안전한 오류로 알린다.
    const failed = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      input,
      {
        redactor: () => null,
      },
    );
    assert(!failed.ok);
    assertEquals(failed.error.code, "unavailable");
    // 통과한 redaction은 묶음을 돌려준다.
    const passed = exportDocument(
      fixture.snapshot() as never,
      userContext(),
      input,
      {
        redactor: (_source, _mediaType, text) => text,
      },
    );
    assert(passed.ok);
    assertEquals(
      (passed.value as { documents: unknown[] }).documents.length,
      1,
    );
  } finally {
    fixture.close();
  }
});
