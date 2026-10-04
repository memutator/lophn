import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { createVersionCommands } from "./commands.ts";
import { createVersionReads, storedFile } from "./reads.ts";
import {
  file,
  ids,
  keep,
  preparedInput,
  userContext,
  versionFixture,
} from "./testing-fixture.ts";

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
