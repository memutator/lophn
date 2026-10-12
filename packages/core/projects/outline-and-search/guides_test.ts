// documents/versions#R17 (documents#T29): 설치 안내 읽기 handler. 설치 폴더는 temp dir에
// 쓴 실제 manifest·파일이고(versions/testing), manifest reader는 제품 createGuideCatalog다.
// 제품 format 추출은 core 시험(apps/core/documents-guides_test.ts)이 reader Worker로
// 확인한다. 여기 extractor는 heading 줄만 나누는 시험용 port 구현이다.
import { assert, assertEquals } from "@std/assert";
import type { RequestContext } from "../../../protocol/platform/mod.ts";
import { createGuideCatalog } from "../versions/mod.ts";
import {
  type GuideFixtureGuide,
  guideInstallFixture,
} from "../versions/testing/mod.ts";
import {
  createGuideHandlers,
  GUIDE_LIST_LIMIT,
  type GuideExtractor,
  type GuideSectionRecord,
} from "./guides.ts";
import { cutOutline, selectBodyLines } from "./outline-support.ts";

const CTX = {
  principal: "user-1",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "cred-a",
} as unknown as RequestContext;
const HASH = "b".repeat(64);
const FORMAT = { name: "document", module_hash: HASH, explicit: false };

// `## `는 level 2, `### `는 level 3 section이다. 시험용 port 구현이다.
const extract: GuideExtractor = (file) => {
  if (file.media_type !== "text/markdown") {
    return { format: FORMAT, extraction: { status: "unsupported" } };
  }
  const text = new TextDecoder().decode(file.bytes);
  if (text.includes("BROKEN")) {
    return {
      format: FORMAT,
      extraction: { status: "failed", failure_reason: "broken guide" },
    };
  }
  const lines = text.split("\n");
  const sections: GuideSectionRecord[] = [];
  let parent: string | null = null;
  lines.forEach((line, index) => {
    const match = /^(#{2,3}) (.+)$/.exec(line);
    if (match === null) return;
    const level = match[1].length;
    const key = match[2].toLowerCase().replaceAll(" ", "-");
    if (level === 2) parent = null;
    const next = lines.findIndex((other, at) =>
      at > index && /^#{2,3} /.test(other)
    );
    const end = next === -1 ? lines.length : next;
    sections.push({
      key,
      title: match[2],
      parent: level === 3 ? parent : null,
      position: sections.length,
      level,
      anchor: null,
      own_ranges: [{ start_line: index + 1, end_line: end }],
      subtree_range: { start_line: index + 1, end_line: end },
      characters: lines.slice(index, end).join("\n").length,
      body_hash: HASH,
    });
    if (level === 2) parent = key;
  });
  return {
    format: FORMAT,
    extraction: { status: "ready", text, text_hash: HASH, sections },
  };
};

function handlers(
  fixture: ReturnType<typeof guideInstallFixture>,
  options: { redactor?: () => string | null } = {},
) {
  return createGuideHandlers({
    catalog: createGuideCatalog(fixture.files),
    extract,
    asOfSeq: "7",
    redactor: options.redactor,
  });
}

function reference(
  fixture: ReturnType<typeof guideInstallFixture>,
  index = 0,
) {
  return {
    lophn_version: fixture.lophnVersion,
    title: fixture.guides[index].title,
    content_hash: fixture.guides[index].content_hash,
  };
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  assert(result.ok, result.ok ? "" : result.error.code);
  return result.value;
}

type Page = Record<string, unknown>;

Deno.test("documents/outline-and-search#R9: 안내 목록은 page 한도로 끊고 cursor로 겹침 없이 잇고 설치가 바뀌면 conflict다", () => {
  const many: GuideFixtureGuide[] = Array.from(
    { length: GUIDE_LIST_LIMIT + 5 },
    (_, index) => ({
      title: `Guide ${index}`,
      path: `guides/g${index}.md`,
      text: `# Guide ${index}\n\n## Part\n\ntext ${index}\n`,
    }),
  );
  const fixture = guideInstallFixture("3.0.0", many);
  try {
    const first = unwrap(handlers(fixture).list(CTX, {})) as Page;
    assertEquals((first["guides"] as unknown[]).length, GUIDE_LIST_LIMIT);
    assertEquals(first["complete"], false);
    const cursor = first["next_cursor"] as string;
    assert(cursor.length > 0);
    const second = unwrap(handlers(fixture).list(CTX, { cursor })) as Page;
    assertEquals((second["guides"] as unknown[]).length, 5);
    assertEquals(second["complete"], true);
    assertEquals(second["next_cursor"], null);
    const titles = [
      ...(first["guides"] as { title: string }[]),
      ...(second["guides"] as { title: string }[]),
    ].map((guide) => guide.title);
    assertEquals(new Set(titles).size, many.length);
    assertEquals(first["as_of_seq"], "7");
    // 다른 credential의 cursor는 이어 보지 않는다.
    const other = handlers(fixture).list(
      { ...CTX, credential_ref: "cred-b" } as RequestContext,
      { cursor },
    );
    assert(!other.ok);
    assertEquals(other.error.code, "invalid_input");
    // 설치가 바뀌면 안정된 기준이 없다.
    fixture.write("3.1.0", many);
    const stale = handlers(fixture).list(CTX, { cursor });
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/outline-and-search#R26: 안내 목차는 section의 위치·hash·문자 수·estimated token·부모·자식 수와 숨긴 자식 수를 낸다", () => {
  const fixture = guideInstallFixture("1.0.0", [{
    title: "Nest",
    path: "g/nest.md",
    text: [
      "# Nest",
      "",
      "## A",
      "",
      "aaaa",
      "",
      "### A1",
      "",
      "a1",
      "",
      "### A2",
      "",
      "a2",
      "",
      "## B",
      "",
      "bbbb",
      "",
    ].join("\n"),
  }]);
  try {
    const page = unwrap(
      handlers(fixture).outline(CTX, {
        reference: reference(fixture),
        path: "g/nest.md",
      }),
    ) as Page;
    assertEquals(page["section_status"], "whole");
    const entries = page["entries"] as {
      key: string;
      level: number;
      estimated_tokens: number;
      characters: number;
      children_count: number;
      hidden_children_count: number;
      parent: string | null;
    }[];
    // depth 2 기본: level 3은 숨고 level 2의 숨긴 자식 수로 알린다.
    assertEquals(entries.map((entry) => entry.key), ["a", "b"]);
    assertEquals(entries[0].children_count, 2);
    assertEquals(entries[0].hidden_children_count, 2);
    assertEquals(entries[1].hidden_children_count, 0);
    assertEquals(
      entries[0].estimated_tokens,
      Math.ceil(entries[0].characters / 3),
    );
    const deep = unwrap(
      handlers(fixture).outline(CTX, {
        reference: reference(fixture),
        path: "g/nest.md",
        depth: 3,
      }),
    ) as Page;
    assertEquals(
      (deep["entries"] as { key: string }[]).map((entry) => entry.key),
      ["a", "a1", "a2", "b"],
    );
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/outline-and-search#R22: 추출이 없는 안내는 section 없이 원문 파일 참조로 답한다", () => {
  const fixture = guideInstallFixture("1.0.0", [
    {
      title: "Plain",
      path: "g/plain.bin",
      text: "binary-ish",
      media_type: "application/octet-stream",
    },
    { title: "Broken", path: "g/broken.md", text: "# T\n\nBROKEN\n" },
    { title: "Fine", path: "g/fine.md", text: "# T\n\n## Only\n\nbody\n" },
  ]);
  try {
    const unsupported = unwrap(
      handlers(fixture).read(CTX, {
        reference: reference(fixture, 0),
        path: "g/plain.bin",
      }),
    ) as Page;
    assertEquals(unsupported["section_status"], "unsupported");
    assertEquals(unsupported["text"], null);
    assertEquals(
      (unsupported["file"] as { path: string }).path,
      "g/plain.bin",
    );
    const broken = unwrap(
      handlers(fixture).outline(CTX, {
        reference: reference(fixture, 1),
        path: "g/broken.md",
      }),
    ) as Page;
    assertEquals(broken["section_status"], "unverified");
    assertEquals(broken["failure_reason"], "broken guide");
    assertEquals(broken["entries"], []);
    assert(broken["file"] !== null);
    const missing = unwrap(
      handlers(fixture).read(CTX, {
        reference: reference(fixture, 2),
        path: "g/fine.md",
        section: "nope",
      }),
    ) as Page;
    assertEquals(missing["section_status"], "missing");
    assertEquals(missing["text"], null);
    const found = unwrap(
      handlers(fixture).read(CTX, {
        reference: reference(fixture, 2),
        path: "g/fine.md",
        section: "only",
      }),
    ) as Page;
    assertEquals(found["section_status"], "found");
    assertEquals(found["text"], "## Only\n\nbody\n");
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/outline-and-search#R8: 안내 본문은 redaction을 끝내지 못하면 본문 없이 이유만 낸다", () => {
  const fixture = guideInstallFixture();
  try {
    const path = fixture.guides[0].path;
    const failed = unwrap(
      handlers(fixture, { redactor: () => null }).read(CTX, {
        reference: reference(fixture),
        path,
      }),
    ) as Page;
    assertEquals(failed["text"], null);
    assertEquals(failed["redacted"], true);
    assertEquals(failed["omission_reason"], "redaction_failed");
    const masked = unwrap(
      handlers(fixture, { redactor: () => "[redacted]" }).read(CTX, {
        reference: reference(fixture),
        path,
      }),
    ) as Page;
    assertEquals(masked["text"], "[redacted]");
    assertEquals(masked["redacted"], true);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("documents/outline-and-search#R7: 줄 범위·section 조각 선택은 비어 있는 section을 전체 본문으로 바꾸지 않는다", () => {
  assertEquals(selectBodyLines(null, [], 3), [1, 2, 3]);
  assertEquals(selectBodyLines([], [], 3), []);
  assertEquals(
    selectBodyLines(
      [{ start_line: 2, end_line: 3 }, {
        start_line: 6,
        end_line: 6,
      }],
      [{ start_line: 3, end_line: 4 }],
      9,
    ),
    [2, 3, 4, 6],
  );
});

Deno.test("documents/outline-and-search#R5: 목차 예산 컷은 offset부터 이어지고 atLeastOne이면 큰 항목 하나는 담는다", () => {
  const sections = ["a", "b", "c"].map((key, position) => ({
    key,
    title: key,
    parent: null,
    position,
    level: 1,
    characters: 300,
    hidden_children_count: 0,
  }));
  // 항목 하나가 100 token + 제목이라 예산 150에는 하나만 든다.
  const first = cutOutline(sections, 2, 150, { atLeastOne: true });
  assertEquals(first.entries.map((entry) => entry.key), ["a"]);
  assertEquals(first.complete, false);
  const next = cutOutline(sections, 2, 150, { offset: 1, atLeastOne: true });
  assertEquals(next.entries.map((entry) => entry.key), ["b"]);
  const tiny = cutOutline(sections, 2, 1, { offset: 2, atLeastOne: true });
  assertEquals(tiny.entries.map((entry) => entry.key), ["c"]);
  assertEquals(tiny.complete, true);
  assertEquals(cutOutline(sections, 2, 1).entries, []);
});
