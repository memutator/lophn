import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import { type ContextCommandDeps, createContextCommands } from "./commands.ts";
import {
  contextExportOutputSchema,
  contextItemSchema,
} from "../../contracts/documents/mod.ts";
import { createContextOutlineSource, createContextReads } from "./reads.ts";
import { contextFixture, ids, keep, userContext } from "./testing/mod.ts";

// apps blueprint read가 들어오기 전 test double. read command만 허용한다.
const deps: ContextCommandDeps = {
  appCommand: (app, command) => app === ids.app && command === "read_notes",
};
const commands = createContextCommands(deps);
const reads = createContextReads();

function item(
  document: string,
  section: string | null,
  perspective: "basis" | "reference" | "watch",
  reason = "판단 근거",
) {
  return {
    target: { kind: "document" as const, document, section },
    perspective,
    reason,
  };
}

function appItem(perspective: "basis" | "reference" | "watch" = "reference") {
  return {
    target: {
      kind: "app_command" as const,
      app: ids.app,
      command: "read_notes",
    },
    perspective,
    reason: "앱 자료",
  };
}

function seedTwo(fixture: ReturnType<typeof contextFixture>) {
  fixture.seedDocument(ids.doc);
  keep(
    fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context,
          title: "기준",
          purpose: "판단 기준 자료",
          items: [
            item(ids.doc, null, "basis"),
            item(ids.doc, "요약", "watch", "변화 확인"),
            appItem(),
          ],
        } as never,
        {},
      )
    ),
  );
  keep(
    fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context2,
          title: "참고",
          purpose: "참고 자료",
          items: [appItem("watch")],
        } as never,
        {},
      )
    ),
  );
}

Deno.test("documents/contexts#R1: context 읽기는 제목·목적·관점·이유를 같은 관점 순서로 돌려준다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as {
      context: {
        id: string;
        items: {
          perspective: string;
          target: { section: string | null };
          reason: string;
        }[];
      };
    };
    assertEquals(got.context.id, ids.context);
    assertEquals(got.context.items.length, 3);
    // position 순서(생성 순서)대로 관점이 구별된다.
    assertEquals(
      got.context.items.map((entry) => entry.perspective),
      ["basis", "watch", "reference"],
    );
    assertEquals(got.context.items[1].reason, "변화 확인");
    // 전체 문서는 section: null로 정규화된다.
    assertEquals(got.context.items[0].target.section, null);
    // list는 둘 다 돌려준다.
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as {
      contexts: { id: string }[];
      complete: boolean;
      next_cursor: string | null;
    };
    assertEquals(listed.contexts.map((context) => context.id), [
      ids.context,
      ids.context2,
    ]);
    assertEquals(listed.complete, true);
    assertEquals(listed.next_cursor, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R2: 읽기는 metadata만 주고 본문·앱 데이터는 대상 read가 연다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = keep(
      reads.get.handle(
        snapshot,
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as {
      context: { items: unknown[]; revision: string; status: string };
    };
    // item은 target·perspective·reason뿐이다. 본문·앱 응답 데이터는 없다.
    for (const entry of got.context.items) {
      assertEquals(Object.keys(entry as never).sort(), [
        "perspective",
        "reason",
        "target",
      ]);
    }
    assertEquals(got.context.status, "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R8: related는 직접 든 context를 항목에서 계산하고 app_command target도 연다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    // 문서 target: 첫 context만 직접 든다.
    const byDocument = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "document", document: ids.doc, section: null },
        } as never,
      ),
    ) as never as { contexts: { id: string }[]; complete: boolean };
    assertEquals(byDocument.contexts.map((context) => context.id), [
      ids.context,
    ]);
    // section target은 전체와 다른 canonical target이다.
    const bySection = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "document", document: ids.doc, section: "요약" },
        } as never,
      ),
    ) as never as { contexts: { id: string }[] };
    assertEquals(bySection.contexts.map((context) => context.id), [
      ids.context,
    ]);
    // app_command target: 두 context가 직접 든다.
    const byCommand = keep(
      reads.related.handle(
        snapshot,
        userContext(),
        {
          target: { kind: "app_command", app: ids.app, command: "read_notes" },
        } as never,
      ),
    ) as never as { contexts: { id: string }[] };
    assertEquals(byCommand.contexts.map((context) => context.id), [
      ids.context,
      ids.context2,
    ]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R5: status 필터와 cursor가 list를 좁히고 보관 context를 숨긴다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: "1" },
        )
      ),
    );
    const snapshot = fixture.snapshot();
    const active = keep(
      reads.list.handle(snapshot, userContext(), { status: "active" } as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(active.contexts.map((context) => context.id), [ids.context2]);
    const all = keep(
      reads.list.handle(snapshot, userContext(), { status: "all" } as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(all.contexts.length, 2);
    void archived;
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R6: 범위 밖 context 읽기는 없는 것과 똑같이 답한다", () => {
  const fixture = contextFixture((_ctx, _operation, target) => {
    const id = (target as { context?: string }).context;
    return id === ids.context
      ? err({ code: "forbidden", message: "범위 밖이다" })
      : { ok: true as const, value: undefined };
  });
  try {
    seedTwo(fixture);
    const snapshot = fixture.snapshot();
    const got = reads.get.handle(
      snapshot,
      userContext(),
      { context: ids.context } as never,
    );
    assert(!got.ok);
    assertEquals(got.error.code, "not_found");
    // 목록은 그 context를 빼고 돌려준다.
    const listed = keep(
      reads.list.handle(snapshot, userContext(), {} as never),
    ) as never as { contexts: { id: string }[] };
    assertEquals(listed.contexts.map((context) => context.id), [ids.context2]);
  } finally {
    fixture.close();
  }
});

const HASH = "a".repeat(64);
const NEW_VERSION = "ver_01arz3ndektsv4rrffq69g5fb1";

// seedDocument는 판 행 없이 문서 행만 심는다. 새 판은 immutable versions 표에 더한다.
function saveNewVersion(
  fixture: ReturnType<typeof contextFixture>,
  version: string,
  number: number,
): void {
  fixture.db.prepare(
    `INSERT INTO versions (id, document, number, files_hash, primary_path, file_count,
       content_hash, format_name, module_hash, format_explicit, saved_by, saved_at)
     VALUES (?, ?, ?, ?, 'a.md', 1, ?, 'document', ?, 1, 'user', '2026-10-05T00:00:00.000Z')`,
  ).run(version, ids.doc, number, HASH, HASH, HASH);
  fixture.db.prepare(`UPDATE documents SET latest_version = ? WHERE id = ?`)
    .run(version, ids.doc);
}

Deno.test("documents/contexts#R4: context 항목은 최신 판을 따르고 읽은 시점의 고정 판 id를 근거로 준다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const source = createContextOutlineSource(fixture.sql);
    const before = keep(source.get(ids.context));
    assert(before !== null);
    const itemBefore = before.items[0];
    assertEquals(itemBefore.target.kind, "document");
    assertEquals(itemBefore.document?.version, `ver_${"0".repeat(26)}`);
    // 새 판이 저장되면 같은 항목이 새 최신 판을 가리킨다. 항목은 바뀌지 않는다.
    saveNewVersion(fixture, NEW_VERSION, 1);
    const after = keep(source.get(ids.context));
    assert(after !== null);
    assertEquals(after.items[0].document?.version, NEW_VERSION);
    assertEquals(after.items.length, before.items.length);
    // 이미 읽은 근거는 그때 고른 고정 판 그대로다.
    assertEquals(itemBefore.document?.version, `ver_${"0".repeat(26)}`);
    // ledger의 항목 행에는 판이 저장되지 않는다.
    const stored = fixture.db.prepare(
      `SELECT * FROM context_items WHERE context = ?`,
    ).get(ids.context) as Record<string, unknown>;
    assertEquals(
      Object.keys(stored).filter((column) => column.includes("version")),
      [],
    );
    // 항목별 옛 판 고정 옵션은 입력에 없다.
    const pinned = contextItemSchema.safeParse({
      target: { kind: "document", document: ids.doc, section: null },
      perspective: "basis",
      reason: "옛 판 고정",
      version: `ver_${"0".repeat(26)}`,
    });
    assertEquals(pinned.success, false);
    // 앱 항목은 문서 판 정보 없이 대상만 준다.
    const app = after.items.find((item) => item.target.kind === "app_command");
    assert(app !== undefined);
    assertEquals(app.document, undefined);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R4: context outline 근원은 보관 context를 활성 목록에서 빼고 항목 순서를 유지한다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const source = createContextOutlineSource(fixture.sql);
    const active = keep(source.active());
    assertEquals(active.map((record) => record.id), [
      ids.context,
      ids.context2,
    ]);
    assertEquals(
      active[0].items.map((item) => item.perspective),
      ["basis", "watch", "reference"],
    );
    const row = fixture.sql.get(
      `SELECT revision FROM contexts WHERE id = ?`,
      [ids.context2],
    );
    keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context2 } as never,
          { base_revision: String(row?.["revision"]) } as never,
        )
      ),
    );
    assertEquals(
      keep(source.active()).map((record) => record.id),
      [ids.context],
    );
    // 보관 context도 id로는 읽는다(보관은 삭제가 아니다).
    assertEquals(keep(source.get(ids.context2))?.status, "archived");
    assertEquals(keep(source.get("ctx_01arz3ndektsv4rrffq69g5fzz")), null);
  } finally {
    fixture.close();
  }
});

// export 시험의 근원. 제품 redactor 대신 같은 모양의 test redactor를 쓴다.
const SECRET = "ghp_" + "a".repeat(30);
const HIDDEN_DOC = "doc_01arz3ndektsv4rrffq69g5fb0";
const redactSecret = (_source: unknown, _media: string, text: string) =>
  text.replaceAll(SECRET, "[redacted]");

function exportReads(
  overrides: Partial<NonNullable<Parameters<typeof createContextReads>[0]>> =
    {},
) {
  return createContextReads({
    redactor: redactSecret,
    glossary: () => ({
      ok: true,
      value: [{ name: "범위", definition: "이번 판단의 대상" }],
    }),
    ...overrides,
  }).export;
}

type Exported = {
  context: {
    id: string;
    purpose: string;
    items: { reason: string; target: { kind: string; document?: string } }[];
  };
  items: {
    perspective: string;
    reason: string;
    fixed_version: string | null;
    section_status: string | null;
    target: { kind: string };
  }[];
  glossary: { name: string; definition: string }[];
  next_cursor: string | null;
};

Deno.test("documents/contexts#R14: export는 목적·직접 항목·이유·고정 판 참조와 glossary를 낸다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const value = keep(
      exportReads().handle(
        fixture.snapshot(),
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as Exported;
    assertEquals(value.context.id, ids.context);
    assertEquals(value.context.purpose, "판단 기준 자료");
    // 관점·이유와 읽은 고정 판(최신 판)이 항목마다 붙는다. 앱 항목은 판이 없다.
    assertEquals(
      value.items.map((entry) => [
        entry.perspective,
        entry.reason,
        entry.fixed_version,
        entry.section_status,
      ]),
      [
        ["basis", "판단 근거", `ver_${"0".repeat(26)}`, "whole"],
        ["watch", "변화 확인", `ver_${"0".repeat(26)}`, "unverified"],
        ["reference", "앱 자료", null, null],
      ],
    );
    assertEquals(value.glossary, [
      { name: "범위", definition: "이번 판단의 대상" },
    ]);
    // 하위 context·관계 지도·다른 context는 담지 않는다.
    assertEquals(
      Object.keys(value as never).sort(),
      ["as_of_seq", "context", "glossary", "items", "next_cursor"],
    );
    assertEquals(JSON.stringify(value).includes(ids.context2), false);
    assert(
      contextExportOutputSchema.safeParse(value).success,
      "export output must match the contract schema",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R14: section 상태는 주입된 근원을 따르고 근원이 없으면 unverified다", () => {
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    const asked: string[] = [];
    const value = keep(
      exportReads({
        sectionStatus: (document, version, section) => {
          asked.push(`${document}/${version}/${section}`);
          return "found";
        },
      }).handle(
        fixture.snapshot(),
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as Exported;
    assertEquals(value.items[0].section_status, "whole");
    assertEquals(value.items[1].section_status, "found");
    assertEquals(asked, [`${ids.doc}/ver_${"0".repeat(26)}/요약`]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R14: 권한 밖 문서·앱 항목은 항목과 context 안에서 모두 빠진다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    fixture.seedDocument(HIDDEN_DOC);
    keep(
      fixture.transaction((tx) =>
        commands.create.handle(
          tx,
          userContext(),
          {
            id: ids.context,
            title: "기준",
            purpose: "판단 기준 자료",
            items: [
              item(ids.doc, null, "basis"),
              item(HIDDEN_DOC, null, "basis", "비밀 문서 이유"),
              appItem(),
            ],
          } as never,
          {},
        )
      ),
    );
    // 만든 뒤에 범위가 좁아진다.
    fixture.use((_ctx, _operation, target) => {
      const record = target as Record<string, unknown>;
      return record["document"] === HIDDEN_DOC || record["app"] !== undefined
        ? err({ code: "forbidden", message: "no" })
        : ok(undefined);
    });
    const value = keep(
      exportReads().handle(
        fixture.snapshot(),
        userContext(),
        { context: ids.context } as never,
      ),
    ) as never as Exported;
    assertEquals(value.items.length, 1);
    assertEquals(value.context.items.length, 1);
    const text = JSON.stringify(value);
    assertEquals(text.includes(HIDDEN_DOC), false);
    assertEquals(text.includes("비밀 문서 이유"), false);
    assertEquals(text.includes(ids.app), false);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R14: 권한 밖 context와 없는 context는 같은 답이고 사람이 아닌 actor는 거절된다", () => {
  const denied = contextFixture((_ctx, _operation, target) =>
    (target as Record<string, unknown>)["context"] !== undefined
      ? err({ code: "forbidden", message: "no" })
      : ok(undefined)
  );
  try {
    seedTwo(denied);
    const hidden = exportReads().handle(
      denied.snapshot(),
      userContext(),
      { context: ids.context } as never,
    );
    const absent = exportReads().handle(
      denied.snapshot(),
      userContext(),
      { context: "ctx_01arz3ndektsv4rrffq69g5fzz" } as never,
    );
    assertEquals(hidden, absent);
    assertEquals(hidden.ok, false);
  } finally {
    denied.close();
  }
  const fixture = contextFixture();
  try {
    seedTwo(fixture);
    for (const actor of ["agent", "coding_agent", "app", "machine"]) {
      const result = exportReads().handle(
        fixture.snapshot(),
        userContext(actor),
        { context: ids.context } as never,
      );
      assert(!result.ok, actor);
      assertEquals(result.error.code, "forbidden");
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R14: 외부 출력은 redaction하고 안전화를 끝내지 못하면 내보내지 않는다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    keep(
      fixture.transaction((tx) =>
        commands.create.handle(
          tx,
          userContext(),
          {
            id: ids.context,
            title: "기준",
            purpose: `목적 ${SECRET}`,
            items: [item(ids.doc, null, "basis", `이유 ${SECRET}`)],
          } as never,
          {},
        )
      ),
    );
    const snapshot = fixture.snapshot();
    const input = { context: ids.context } as never;
    const value = keep(
      exportReads({
        glossary: () => ({
          ok: true,
          value: [{ name: "키", definition: `정의 ${SECRET}` }],
        }),
      }).handle(snapshot, userContext(), input),
    ) as never as Exported;
    const text = JSON.stringify(value);
    assertEquals(text.includes(SECRET), false);
    assert(text.includes("[redacted]"));
    // redactor 조립이 없거나, 어느 필드든 안전화에 실패하면 export 전체가 거절된다.
    for (
      const read of [
        exportReads({ redactor: undefined }),
        exportReads({ redactor: () => null }),
        exportReads({
          redactor: (_source, _media, field) =>
            field.startsWith("정의") ? null : field,
          glossary: () => ({
            ok: true,
            value: [{ name: "키", definition: "정의 값" }],
          }),
        }),
        exportReads({ glossary: undefined }),
      ]
    ) {
      const result = read.handle(snapshot, userContext(), input);
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
    }
  } finally {
    fixture.close();
  }
});
