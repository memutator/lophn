import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Address } from "../../contracts/documents/mod.ts";
import { createAddressingReads } from "./reads.ts";
import { ids, userContext, versionFixture } from "../versions/testing/mod.ts";

const reads = createAddressingReads();
const project = "prj_01arz3ndektsv4rrffq69g5fav";
const otherProject = "prj_01arz3ndektsv4rrffq69g5faw";
const HASH = "ab".repeat(32);

type Fixture = ReturnType<typeof versionFixture>;

let placeSeq = 0;

function seedPlace(fixture: Fixture, slug: string, target: string) {
  placeSeq += 1;
  fixture.db
    .prepare(
      "INSERT INTO place_names (slug, kind, target, reserved_seq) VALUES (?, 'project', ?, ?)",
    )
    .run(slug, target, String(placeSeq));
}

function seedDocumentName(
  fixture: Fixture,
  placeId: string,
  name: string,
  document: string,
) {
  placeSeq += 1;
  fixture.db
    .prepare(
      "INSERT INTO document_names (place_kind, place_id, name, document, reserved_seq) VALUES ('project', ?, ?, ?, ?)",
    )
    .run(placeId, name, document, String(placeSeq));
}

// 판 하나짜리 문서 row. place가 null이면 자리 없는 문서다.
function seedDocument(
  fixture: Fixture,
  id: string,
  place: { kind: "project" | "app"; id: string } | null,
  name: string | null,
  title = "Notes",
) {
  const versionId = `ver_${id.slice(4).slice(0, 24)}01`;
  fixture.db
    .prepare(
      `INSERT INTO documents (id, place_kind, place_id, name, title, source_kind,
         source_instruction_target, source_project, source_path, latest_version, revision, status)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, '1', 'active')`,
    )
    .run(id, place?.kind ?? null, place?.id ?? null, name, title, versionId);
  fixture.db
    .prepare(
      `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
         content_hash, format_name, module_hash, format_explicit, saved_by, saved_at, run, source)
       VALUES (?, ?, 1, ?, 'a.md', 1, ?, 'document', ?, 0, 'user', '2026-10-05T00:00:00.000Z', NULL, NULL)`,
    )
    .run(versionId, id, HASH, HASH, HASH);
}

function resolve(
  fixture: Fixture,
  reference: Address | {
    document: string;
    version: string | null;
    section: string | null;
  },
) {
  return reads.resolve.handle(
    fixture.snapshot() as never,
    userContext(),
    { reference },
  );
}

function testAddress(place: string, document: string): Address {
  return { place, document, section: null, version: null };
}

function keepVer(_fixture: Fixture, id: string, number: number): string {
  return `ver_${id.slice(4).slice(0, 24)}${String(number).padStart(2, "0")}`;
}

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
) {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

Deno.test("documents/addressing#R1: place 예약에서 ID를 얻고 (place ID, 이름) 예약으로 문서를 찾는다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    const resolved = keep(resolve(fixture, testAddress("mahas", "report")));
    assertEquals(resolved.resolved.document, ids.doc);
    assertEquals(resolved.resolved.redirected, false);
    assertEquals(resolved.resolved.section_status, "whole");
    assertEquals(resolved.resolved.current_reference, {
      place: "mahas",
      document: "report",
      section: null,
      version: 1,
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R1: version을 지정하면 그 판, 없으면 해석 시점 최신 판을 고른다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocumentWithVersions(
      fixture,
      ids.doc,
      { kind: "project", id: project },
      "report",
      2,
    );
    const versionId = (number: number) =>
      `ver_${ids.doc.slice(4).slice(0, 24)}${String(number).padStart(2, "0")}`;
    const resolved = keep(
      resolve(fixture, { ...testAddress("mahas", "report"), version: 1 }),
    );
    assertEquals(resolved.resolved.version, versionId(1));
    assertEquals(resolved.resolved.current_reference, {
      place: "mahas",
      document: "report",
      section: null,
      version: 1,
    });
    const latest = keep(resolve(fixture, testAddress("mahas", "report")));
    assertEquals(latest.resolved.version, versionId(2));
    assertEquals(latest.resolved.current_reference.version, 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R3: 자리 없는 문서는 DocumentRef로 읽고 address로는 찾지 않는다", () => {
  const fixture = versionFixture();
  try {
    seedDocument(fixture, ids.doc, null, null);
    const got = keep(
      resolve(fixture, { document: ids.doc, version: null, section: null }),
    );
    assertEquals(got.resolved.document, ids.doc);
    assertEquals(got.resolved.redirected, false);
    assertEquals(got.resolved.current_reference, {
      document: ids.doc,
      version: keepVer(fixture, ids.doc, 1),
      section: null,
    });
    code(resolve(fixture, testAddress("mahas", "report")), "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R6: 옛 project 이름과 옛 문서 이름도 같은 대상의 현재 참조로 안내한다", () => {
  const fixture = versionFixture();
  try {
    //mahas가 옛 slug, memo가 현재 slug다. report가 옛 이름, weekly가 현재 이름이다.
    seedPlace(fixture, "mahas", project);
    seedPlace(fixture, "memo", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocumentName(fixture, project, "weekly", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "weekly");
    const resolved = keep(resolve(fixture, testAddress("mahas", "report")));
    assertEquals(resolved.resolved.document, ids.doc);
    assertEquals(resolved.resolved.redirected, true);
    assertEquals(resolved.resolved.current_reference, {
      place: "memo",
      document: "weekly",
      section: null,
      version: 1,
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R6: 이름·자리를 여러 번 바꾼 뒤 처음 address로 지정 판에 닿는다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "first-place", project);
    seedPlace(fixture, "second-place", project);
    seedPlace(fixture, "third-place", otherProject);
    seedDocumentName(fixture, project, "first-name", ids.doc);
    seedDocumentName(fixture, project, "second-name", ids.doc);
    seedDocumentName(fixture, otherProject, "third-name", ids.doc);
    seedDocumentWithVersions(
      fixture,
      ids.doc,
      { kind: "project", id: otherProject },
      "third-name",
      2,
    );
    const resolved = keep(
      resolve(fixture, {
        ...testAddress("first-place", "first-name"),
        version: 1,
      }),
    );
    assertEquals(resolved.resolved.document, ids.doc);
    assertEquals(resolved.resolved.redirected, true);
    assertEquals(resolved.resolved.version, keepVer(fixture, ids.doc, 1));
    assertEquals(resolved.resolved.current_reference, {
      place: "third-place",
      document: "third-name",
      section: null,
      version: 1,
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R7: 보관·자리 없음이 된 대상도 예약을 지우지 않고 상태·ID 읽기를 안내한다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    fixture.db
      .prepare("UPDATE documents SET status = 'archived' WHERE id = ?")
      .run(ids.doc);
    const archived = keep(resolve(fixture, testAddress("mahas", "report")));
    assertEquals(archived.resolved.document, ids.doc);
    assertEquals(archived.resolved.redirected, false);
    assertEquals(archived.resolved.current_reference, {
      place: "mahas",
      document: "report",
      section: null,
      version: 1,
    });
    fixture.db
      .prepare(
        "UPDATE documents SET place_kind = NULL, place_id = NULL, name = NULL WHERE id = ?",
      )
      .run(ids.doc);
    const placeless = keep(resolve(fixture, testAddress("mahas", "report")));
    assertEquals(placeless.resolved.document, ids.doc);
    assertEquals(placeless.resolved.redirected, true);
    assertEquals(placeless.resolved.current_reference, {
      document: ids.doc,
      version: keepVer(fixture, ids.doc, 1),
      section: null,
    });
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R6: 옛 address도 현재 scope로 검사하고 권한을 넓히지 않는다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    fixture.use(() =>
      err({ code: "forbidden", message: "대상이 범위 밖이다" })
    );
    // 범위 밖은 존재를 알려주지 않는다. not_found와 정확히 같은 응답이다(platform/identity#R10).
    const outOfScope = resolve(fixture, testAddress("mahas", "report"));
    code(outOfScope, "not_found");
    const absent = resolve(fixture, testAddress("missing", "report"));
    assertEquals(outOfScope, absent);
    // 판을 지정해도 범위 검사가 먼저다. 판 존재를 leak하지 않는다.
    const versionOutOfScope = resolve(
      fixture,
      { ...testAddress("mahas", "report"), version: 1 },
    );
    assertEquals(versionOutOfScope, absent);
    const versionAbsent = resolve(
      fixture,
      { ...testAddress("mahas", "report"), version: 9 },
    );
    assertEquals(versionOutOfScope, versionAbsent);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/addressing#R6: 존재하지 않는 place·문서·판은 not_found다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    code(resolve(fixture, testAddress("missing", "report")), "not_found");
    code(resolve(fixture, testAddress("mahas", "missing")), "not_found");
    code(
      resolve(fixture, { ...testAddress("mahas", "report"), version: 9 }),
      "not_found",
    );
  } finally {
    fixture.close();
  }
});

// 판 여러 개. number마다 id가 달라야 해석 검사가 판을 구별한다.
function seedDocumentWithVersions(
  fixture: Fixture,
  id: string,
  place: { kind: "project" | "app"; id: string } | null,
  name: string | null,
  count: number,
) {
  // 마지막 두 자리에 판 number를 십진수로 넣는다. 접미사를 붙이면 length CHECK를 통과하지 못하고,
  // parseInt 기준원은 2^53을 넘어 정밀도를 잃는다.
  const versionId = (number: number) =>
    `ver_${id.slice(4).slice(0, 24)}${String(number).padStart(2, "0")}`;
  fixture.db
    .prepare(
      `INSERT INTO documents (id, place_kind, place_id, name, title, source_kind,
         source_instruction_target, source_project, source_path, latest_version, revision, status)
       VALUES (?, ?, ?, ?, 'Notes', NULL, NULL, NULL, NULL, ?, '1', 'active')`,
    )
    .run(
      id,
      place?.kind ?? null,
      place?.id ?? null,
      name,
      versionId(count),
    );
  for (let number = 1; number <= count; number++) {
    fixture.db
      .prepare(
        `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
           content_hash, format_name, module_hash, format_explicit, saved_by, saved_at, run, source)
         VALUES (?, ?, ?, ?, 'a.md', 1, ?, 'document', ?, 0, 'user', '2026-10-05T00:00:00.000Z', NULL, NULL)`,
      )
      .run(versionId(number), id, number, HASH, HASH, HASH);
  }
}

function keep<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  assert(result.ok, JSON.stringify("error" in result ? result.error : ""));
  return result.value;
}

// section 해석 근원(documents/addressing#R4, R5). 고정 판의 section 목록을 주입해 받는다.
type StoredSectionLike = { key: string; title: string; parent: string | null };

function resolveWith(
  source: {
    sections(version: string): Result<readonly StoredSectionLike[]>;
  } | undefined,
  fixture: Fixture,
  reference: Address | {
    document: string;
    version: string | null;
    section: string | null;
  },
) {
  const reads = createAddressingReads(source);
  return reads.resolve.handle(
    fixture.snapshot() as never,
    userContext(),
    { reference },
  );
}

function sectionsOf(...list: StoredSectionLike[]) {
  return {
    sections(_version: string): Result<readonly StoredSectionLike[]> {
      return ok(list);
    },
  };
}

function failSections() {
  return {
    sections(_version: string): Result<readonly StoredSectionLike[]> {
      return err({ code: "internal", message: "read failed" });
    },
  };
}

// 전체 경로를 우선하고 유일한 마지막 이름으로도 찾는다(R4).
Deno.test("documents/addressing#R4: section 해석은 전체 경로를 우선하고 유일한 마지막 이름으로도 찾는다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    const source = sectionsOf(
      { key: "intro", title: "소개", parent: null },
      { key: "intro-setup", title: "설치", parent: "intro" },
      { key: "other-setup", title: "설치", parent: null },
    );
    // 전체 경로. 고유하다.
    const byPath = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "소개/설치" },
      ),
    );
    assertEquals(byPath.resolved.section_status, "found");
    // 유일한 마지막 이름으로도 찾는다. "소개"는 하나다.
    const byName = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "소개" },
      ),
    );
    assertEquals(byName.resolved.section_status, "found");
    // 전체 경로가 없으면 missing이다. 유사 section으로 redirect하지 않는다.
    const absent = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "소개/없음" },
      ),
    );
    assertEquals(absent.resolved.section_status, "missing");
    assertEquals(absent.resolved.current_reference.section, "소개/없음");
  } finally {
    fixture.close();
  }
});

// 중복 마지막 이름은 모호함 invalid_input이다(R4).
Deno.test("documents/addressing#R4: 중복 마지막 이름은 모호함 invalid_input이다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    const source = sectionsOf(
      { key: "intro", title: "소개", parent: null },
      { key: "intro-setup", title: "설치", parent: "intro" },
      { key: "other-setup", title: "설치", parent: null },
    );
    // "설치"가 둘이다. byPath가 이기므로 전체 경로는 찾는다. 경로는 title이다.
    const byPath = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "소개/설치" },
      ),
    );
    assertEquals(byPath.resolved.section_status, "found");
    // 전체 경로가 없어서 이름만 본다. 둘이면 모호함이다.
    code(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "설치" },
      ),
      "invalid_input",
    );
    // parent 사슬로 같은 경로가 둘이면 모호함이다.
    code(
      resolveWith(
        sectionsOf(
          { key: "a", title: "부", parent: null },
          { key: "a-setup", title: "설치", parent: "a" },
          { key: "b", title: "부", parent: null },
          { key: "b-setup", title: "설치", parent: "b" },
        ),
        fixture,
        { ...testAddress("mahas", "report"), section: "부/설치" },
      ),
      "invalid_input",
    );
  } finally {
    fixture.close();
  }
});

// 근원의 실패·빈 목록은 미확인이다(R5).
Deno.test("documents/addressing#R5: 근원 실패는 unverified, 빈 section은 unsupported다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    // 근원이 읽지 못한 판. unverified다.
    const failed = keep(
      resolveWith(
        failSections(),
        fixture,
        { ...testAddress("mahas", "report"), section: "설치" },
      ),
    );
    assertEquals(failed.resolved.section_status, "unverified");
    // section이 없는 판. unsupported다.
    const empty = keep(
      resolveWith(
        sectionsOf(),
        fixture,
        { ...testAddress("mahas", "report"), section: "설치" },
      ),
    );
    assertEquals(empty.resolved.section_status, "unsupported");
  } finally {
    fixture.close();
  }
});

// 같은 key만 이어진다. 유사 section redirect는 없다(R5).
Deno.test("documents/addressing#R5: 같은 key만 이어지고 유사 section redirect는 없다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocument(fixture, ids.doc, { kind: "project", id: project }, "report");
    // key 사슬로 경로를 만든다. title만으로 경로가 만들어지지 않는다.
    const source = sectionsOf(
      { key: "intro", title: "소개", parent: null },
      { key: "intro-setup", title: "설치", parent: "intro" },
    );
    const byKey = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "소개/설치" },
      ),
    );
    assertEquals(byKey.resolved.section_status, "found");
    // key는 다르고 title만 같은 사슬. 경로가 아니면 missing이다.
    const similar = keep(
      resolveWith(
        sectionsOf(
          { key: "intro", title: "소개", parent: null },
          { key: "setup", title: "설치", parent: null },
        ),
        fixture,
        { ...testAddress("mahas", "report"), section: "소개/설치" },
      ),
    );
    assertEquals(similar.resolved.section_status, "missing");
    assertEquals(similar.resolved.current_reference.section, "소개/설치");
  } finally {
    fixture.close();
  }
});

// 옛 판을 지정한 참조는 당시 판의 section이다. 최신 참조는 최신 판을 본다(R4).
Deno.test("documents/addressing#R4: 옛 판 지정 참조는 당시 판의 section을 본다", () => {
  const fixture = versionFixture();
  try {
    seedPlace(fixture, "mahas", project);
    seedDocumentName(fixture, project, "report", ids.doc);
    seedDocumentWithVersions(
      fixture,
      ids.doc,
      { kind: "project", id: project },
      "report",
      2,
    );
    const versionId = (number: number) =>
      `ver_${ids.doc.slice(4).slice(0, 24)}${String(number).padStart(2, "0")}`;
    // 옛 판에는 있고 최신 판에는 없는 section. 같는 근원은 판별 목록이다.
    const source = {
      sections(version: string) {
        const list = version === versionId(1)
          ? [{ key: "old", title: "옛절", parent: null }]
          : [];
        return { ok: true as const, value: list };
      },
    };
    const oldOne = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), version: 1, section: "옛절" },
      ),
    );
    assertEquals(oldOne.resolved.section_status, "found");
    // 최신 판에서는 없다. 소실 표시다.
    const latest = keep(
      resolveWith(
        source,
        fixture,
        { ...testAddress("mahas", "report"), section: "옛절" },
      ),
    );
    assertEquals(latest.resolved.section_status, "unsupported");
  } finally {
    fixture.close();
  }
});
