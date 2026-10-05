import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  termGetOutputSchema,
  termListOutputSchema,
} from "../../contracts/documents/mod.ts";
import type { Term, TermEvidence } from "../../contracts/documents/mod.ts";
import type { TargetAuthorizer } from "../../contracts/platform/mod.ts";
import { contextFixture } from "../contexts/testing/mod.ts";
import { createContextCommands } from "../contexts/mod.ts";
import { createTermCommands } from "./commands.ts";
import { createTermReads } from "./reads.ts";
import { ids, keep, termFixture, userContext } from "./testing/mod.ts";

const commands = createTermCommands();
const reads = createTermReads();
const AGENT = `agent:${ids.run.replace("run_", "asg_")}`;

// 다른 leaf의 fixture는 이 *_test.ts가 만들어 넘긴다.
const newFixture = (authorize?: TargetAuthorizer) =>
  termFixture(contextFixture(authorize));
type Fixture = ReturnType<typeof newFixture>;

function section(key = "요약", version = ids.version1): TermEvidence {
  return {
    document: ids.doc,
    version,
    section: key,
    start_line: null,
    end_line: null,
  };
}

function setup(authorize?: TargetAuthorizer): Fixture {
  const fixture = newFixture(authorize);
  fixture.seedContext(ids.context);
  fixture.seedContext(ids.context2);
  fixture.seedDocument(ids.doc);
  fixture.seedVersion(ids.doc, ids.version1, 1);
  return fixture;
}

function termId(n: number): string {
  return ids.term(n);
}

function define(
  fixture: Fixture,
  n: number,
  name: string,
  definition: string,
  context = ids.context,
): Term {
  return keep(fixture.transaction((tx) =>
    commands.define.handle(
      tx,
      userContext(),
      { id: termId(n), context, name, definition } as never,
      {},
    )
  ));
}

function propose(
  fixture: Fixture,
  n: number,
  name: string,
  context = ids.context,
): Term {
  return keep(fixture.transaction((tx) =>
    commands.propose.handle(
      tx,
      userContext(AGENT, ids.run),
      { id: termId(n), context, name, evidence: [section()] } as never,
      {},
    )
  ));
}

function archive(fixture: Fixture, term: Term): Term {
  return keep(fixture.transaction((tx) =>
    commands.archive.handle(
      tx,
      userContext(),
      { term: term.id } as never,
      { base_revision: term.revision },
    )
  ));
}

function list(
  fixture: Fixture,
  input: Record<string, unknown>,
  actor = userContext(),
) {
  return reads.list.handle(fixture.snapshot() as never, actor, input as never);
}

function listed(fixture: Fixture, input: Record<string, unknown>) {
  const page = keep(list(fixture, input)) as {
    definitions: Term[];
    candidates: Term[];
    complete: boolean;
    next_cursor: string | null;
  };
  const parsed = termListOutputSchema.safeParse(page);
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  return page;
}

const pad = (n: number) => String(n).padStart(2, "0");

Deno.test("documents/terms#R4: 정의 35개와 후보를 읽으면 정의 30개·5개를 이어 받고 후보는 별도 목록에 보인다", () => {
  const fixture = setup();
  try {
    // 이름 순서와 만든 순서를 섞어 둔다.
    for (let n = 35; n >= 1; n -= 1) {
      define(fixture, n, `용어${pad(n)}`, `${n}번 뜻`);
    }
    for (let n = 1; n <= 5; n += 1) propose(fixture, 100 + n, `후보${pad(n)}`);
    const first = listed(fixture, { context: ids.context });
    assertEquals(first.definitions.length, 30);
    assertEquals(first.definitions[0].name, "용어01");
    assertEquals(first.definitions[29].name, "용어30");
    assertEquals(first.candidates.map((term) => term.name), [
      "후보01",
      "후보02",
      "후보03",
      "후보04",
      "후보05",
    ]);
    assertEquals(first.complete, false);
    assert(first.next_cursor !== null);
    assert(first.definitions.every((term) => term.definition !== null));
    assert(first.candidates.every((term) => term.definition === null));
    const second = listed(fixture, {
      context: ids.context,
      cursor: first.next_cursor,
    });
    assertEquals(second.definitions.map((term) => term.name), [
      "용어31",
      "용어32",
      "용어33",
      "용어34",
      "용어35",
    ]);
    // 후보는 첫 page에서 다 보였으므로 이어 받는 page에서 되풀이하지 않는다.
    assertEquals(second.candidates, []);
    assertEquals(second.complete, true);
    assertEquals(second.next_cursor, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R4: 작은 limit로 이어 읽으면 정의와 후보를 중복·누락 없이 모두 받는다", () => {
  const fixture = setup();
  try {
    for (let n = 1; n <= 7; n += 1) define(fixture, n, `정의${pad(n)}`, "뜻");
    for (let n = 1; n <= 12; n += 1) propose(fixture, 100 + n, `후보${pad(n)}`);
    const definitions: string[] = [];
    const candidates: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = listed(fixture, {
        context: ids.context,
        limit: 5,
        ...(cursor === undefined ? {} : { cursor }),
      });
      definitions.push(...page.definitions.map((term) => term.name));
      candidates.push(...page.candidates.map((term) => term.name));
      cursor = page.next_cursor ?? undefined;
      pages += 1;
      assert(pages <= 5, "cursor가 끝나지 않는다");
    } while (cursor !== undefined);
    assertEquals(pages, 3);
    assertEquals(definitions.length, 7);
    assertEquals(candidates.length, 12);
    assertEquals(new Set(definitions).size, 7);
    assertEquals(new Set(candidates).size, 12);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R4: glossary는 활성 용어만 context 안에서 읽고 이상한 cursor는 거절한다", () => {
  const fixture = setup();
  try {
    const kept = define(fixture, 1, "남는 용어", "뜻");
    const gone = define(fixture, 2, "보관 용어", "뜻");
    archive(fixture, gone);
    const other = define(fixture, 3, "다른 context", "뜻", ids.context2);
    const page = listed(fixture, { context: ids.context });
    assertEquals(page.definitions.map((term) => term.id), [kept.id]);
    assertEquals(
      listed(fixture, { context: ids.context2 }).definitions.map((term) =>
        term.id
      ),
      [other.id],
    );
    for (const cursor of ["x", "1", "1.x", "01.0", "-1.0", "1.0.0"]) {
      const result = list(fixture, { context: ids.context, cursor });
      assert(!result.ok, cursor);
      assertEquals(result.error.code, "invalid_input");
    }
    // 없는 context.
    const absent = list(fixture, { context: ids.context3 });
    assert(!absent.ok);
    assertEquals(absent.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R1: 후보는 정의와 따로 보이고 고정 판 근거가 그대로 읽힌다", () => {
  const fixture = setup();
  try {
    define(fixture, 1, "정의", "사람의 뜻");
    const candidate = propose(fixture, 2, "후보");
    fixture.seedVersion(ids.doc, ids.version2, 2);
    fixture.db.prepare(`UPDATE documents SET latest_version = ? WHERE id = ?`)
      .run(ids.version2, ids.doc);
    const page = listed(fixture, { context: ids.context });
    assertEquals(page.definitions.map((term) => term.name), ["정의"]);
    assertEquals(page.candidates.map((term) => term.id), [candidate.id]);
    assertEquals(page.candidates[0].evidence, [section()]);
    assertEquals(page.candidates[0].evidence[0].version, ids.version1);
    const got = keep(
      reads.get.handle(
        fixture.snapshot() as never,
        userContext(),
        { term: candidate.id } as never,
      ),
    );
    assert(termGetOutputSchema.safeParse(got).success);
    assertEquals(got.term.definition, null);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R5: 보관된 용어도 get으로 정의와 고정 근거를 읽고 목록에서는 빠진다", () => {
  const fixture = setup();
  try {
    const term = keep(fixture.transaction((tx) =>
      commands.define.handle(
        tx,
        userContext(),
        {
          id: termId(1),
          context: ids.context,
          name: "정의",
          definition: "사람의 뜻",
          evidence: [section()],
        } as never,
        {},
      )
    ));
    archive(fixture, term);
    const got = keep(
      reads.get.handle(
        fixture.snapshot() as never,
        userContext(),
        { term: term.id } as never,
      ),
    );
    assert(termGetOutputSchema.safeParse(got).success);
    assertEquals(got.term.status, "archived");
    assertEquals(got.term.definition, "사람의 뜻");
    assertEquals(got.term.evidence, [section()]);
    const page = listed(fixture, { context: ids.context });
    assertEquals(page.definitions, []);
    assertEquals(page.candidates, []);
    assertEquals(page.complete, true);
    const missing = reads.get.handle(
      fixture.snapshot() as never,
      userContext(),
      { term: termId(99) } as never,
    );
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R4: 범위 밖 context의 용어와 읽을 수 없는 문서의 근거는 없는 것과 같다", () => {
  let hideContext = false;
  let hideDocument = false;
  const scoped: TargetAuthorizer = (_ctx, _operation, target) => {
    if (hideContext && "context" in target) {
      return err({ code: "forbidden", message: "out of scope" });
    }
    if (hideDocument && "document" in target) {
      return err({ code: "forbidden", message: "out of scope" });
    }
    return ok(undefined);
  };
  const fixture = setup(scoped);
  try {
    const term = define(fixture, 1, "정의", "뜻");
    const candidate = propose(fixture, 2, "후보");
    assertEquals(candidate.evidence.length, 1);
    // 문서를 읽을 수 없으면 근거만 빠지고 용어는 보인다.
    hideDocument = true;
    const page = listed(fixture, { context: ids.context });
    assertEquals(page.candidates[0].evidence, []);
    assertEquals(page.definitions[0].id, term.id);
    hideDocument = false;
    // context가 범위 밖이면 list·get 모두 없는 것과 같은 not_found다.
    hideContext = true;
    const hidden = list(fixture, { context: ids.context });
    const absent = list(fixture, { context: ids.context3 });
    assert(!hidden.ok && !absent.ok);
    assertEquals(hidden.error, absent.error);
    const got = reads.get.handle(
      fixture.snapshot() as never,
      userContext(),
      { term: term.id } as never,
    );
    assert(!got.ok);
    assertEquals(got.error.code, "not_found");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R6: 앱 read command를 항목으로 가진 context의 사람 정의를 읽어도 아무것도 쓰지 않고 후보와 섞이지 않는다", () => {
  const fixture = setup();
  try {
    const contexts = createContextCommands({
      appCommand: (_app, command) => command.startsWith("read_"),
    });
    keep(fixture.transaction((tx) =>
      contexts.create.handle(
        tx,
        userContext(),
        {
          id: ids.context3,
          title: "앱 용어",
          purpose: "앱의 말",
          items: [{
            target: {
              kind: "app_command",
              app: ids.app,
              command: "read_notes",
            },
            perspective: "reference",
            reason: "앱 자료",
          }],
        } as never,
        {},
      )
    ));
    define(fixture, 1, "노트", "앱이 다루는 글", ids.context3);
    propose(fixture, 2, "초안", ids.context3);
    const dump = () =>
      JSON.stringify(
        ["contexts", "context_items", "documents", "versions", "terms"]
          .map((table) => fixture.db.prepare(`SELECT * FROM ${table}`).all()),
        (_key, value) => typeof value === "bigint" ? Number(value) : value,
      );
    const before = dump();
    const events = fixture.emitted.length;
    const page = listed(fixture, { context: ids.context3 });
    // 앱 설명을 읽을 근거는 사람 정의뿐이고 후보는 별도 목록이다.
    assertEquals(page.definitions.map((term) => term.name), ["노트"]);
    assertEquals(page.candidates.map((term) => term.name), ["초안"]);
    assertEquals(dump(), before);
    assertEquals(fixture.emitted.length, events);
  } finally {
    fixture.close();
  }
});
