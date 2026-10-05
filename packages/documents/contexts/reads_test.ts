import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { type ContextCommandDeps, createContextCommands } from "./commands.ts";
import { createContextReads } from "./reads.ts";
import { contextFixture, ids, keep, userContext } from "./testing-fixture.ts";

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
