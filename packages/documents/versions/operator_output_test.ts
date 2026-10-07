// documents/versions#R14: Operator 출력의 저장 범위. Operator 자격의 저장은 그 assignment가 선언한
// 기존 출력 Document에 새 판만 더한다. 새 Document·자리·format 변경·series 다음 문서 생성은
// forbidden이고, 출력이 아닌 문서와 다른 assignment의 출력은 없는 문서와 똑같이 답한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
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
const NEXT_HASH = "cd".repeat(32);
const THIRD_HASH = "ef".repeat(32);
const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const OTHER_ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5faw";
const OTHER_DOC = "doc_01arz3ndektsv4rrffq69g5fax";
const THIRD_DOC = "doc_01arz3ndektsv4rrffq69g5fay";
const ABSENT_DOC = "doc_01arz3ndektsv4rrffq69g5fb0";
const NEXT_IN_SERIES = "doc_01arz3ndektsv4rrffq69g5fb1";

type Fixture = ReturnType<typeof makeFixture>;

// 문서 → 출력으로 가진 assignment. 판정 port가 같은 Tx에서 이 표를 읽는다.
function makeFixture(outputs: Map<string, string>) {
  return versionFixture(
    undefined,
    undefined,
    {
      output: (document: string) => {
        const assignment = outputs.get(document);
        return ok(
          assignment === undefined
            ? null
            : { assignment, revision: 1, state: "enabled" as const },
        );
      },
    },
  );
}

function operator(assignment = ASSIGNMENT, role = "operator") {
  return {
    ...userContext(`agent:${assignment}`, ids.run),
    scope: {
      operations: [],
      targets: {},
      agent: { role, assignment, apps: [] },
    },
  };
}

function save(
  fixture: Fixture,
  input: ReturnType<typeof preparedInput>,
  actor: ReturnType<typeof operator> | ReturnType<typeof userContext>,
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor as never, input as never, {
      base_version: input.base_version,
    })
  );
}

function human(fixture: Fixture, document: string, hash = HASH) {
  return keep(
    save(
      fixture,
      preparedInput(document, [file("a.md", true)], {
        content_hash: hash,
        idempotency_key: `seed-${document}`,
      }),
      userContext(),
    ),
  );
}

function next(
  fixture: Fixture,
  document: string,
  base: string,
  hash: string,
  key: string,
  extra: Record<string, unknown> = {},
  actor = operator(),
) {
  return save(
    fixture,
    preparedInput(document, [file("a.md", true)], {
      base_version: base,
      content_hash: hash,
      metadata: undefined,
      idempotency_key: key,
      ...extra,
    }),
    actor,
  );
}

function documentCount(fixture: Fixture): number {
  return Number(
    fixture.sql.get("SELECT count(*) AS n FROM documents", [])?.["n"],
  );
}

function versionCount(fixture: Fixture, document: string): number {
  return Number(
    fixture.sql.get(
      "SELECT count(*) AS n FROM versions WHERE document = ?",
      [document],
    )?.["n"],
  );
}

function forbidden(result: ReturnType<typeof save>): string {
  assert(!result.ok);
  assertEquals(result.error.code, "forbidden");
  return result.error.message;
}

Deno.test("documents/versions#R14: Operator는 assignment의 기존 출력 Document에 새 판을 더하고 회차마다 같은 Document의 새 판이 되며 앞 회차는 고정 판으로 남는다", () => {
  const fixture = makeFixture(new Map([[ids.doc, ASSIGNMENT]]));
  try {
    const seed = human(fixture, ids.doc);
    const first = keep(next(fixture, ids.doc, seed.version, NEXT_HASH, "r1"));
    assertEquals(first.status, "saved");
    const second = keep(
      next(fixture, ids.doc, first.version, THIRD_HASH, "r2"),
    );
    assertEquals(second.status, "saved");
    assert(second.version !== first.version);
    assertEquals(second.reference.document, ids.doc);
    assertEquals(versionCount(fixture, ids.doc), 3);
    // 앞 회차의 판은 새 회차 뒤에도 고정 참조로 그대로 열리고 Operator가 남긴 판이다.
    for (const saved of [first, second]) {
      const opened = keep(
        reads.get.handle(
          fixture.snapshot() as never,
          userContext(),
          { document: ids.doc, version: saved.version },
        ),
      );
      assertEquals(opened.reference, saved.reference);
      assertEquals(opened.version.saved_by, `agent:${ASSIGNMENT}`);
      assertEquals(opened.version.run, ids.run);
    }
    assertEquals(
      fixture.sql.get("SELECT content_hash FROM versions WHERE id = ?", [
        first.version,
      ])?.["content_hash"],
      NEXT_HASH,
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: Operator의 새 Document 생성과 series의 다음 문서 생성은 forbidden이고 문서를 만들지 않는다", () => {
  const fixture = makeFixture(new Map([[ids.doc, ASSIGNMENT]]));
  try {
    human(fixture, ids.doc);
    const before = documentCount(fixture);
    for (
      const [document, place] of [
        [ABSENT_DOC, null],
        [NEXT_IN_SERIES, { kind: "project", id: ids.project }],
      ] as const
    ) {
      const created = save(
        fixture,
        preparedInput(document, [file("a.md", true)], {
          idempotency_key: `create-${document}`,
          metadata: { title: "Weekly 2", place, name: null },
        }),
        operator(),
      );
      forbidden(created);
    }
    assertEquals(documentCount(fixture), before);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: Operator의 자리·이름 변경 입력과 format 변경은 forbidden이고 최신 판의 format 계약을 따른 저장은 된다", () => {
  const fixture = makeFixture(new Map([[ids.doc, ASSIGNMENT]]));
  try {
    const seed = human(fixture, ids.doc);
    // 자리·이름·제목을 정하는 입력.
    forbidden(
      next(fixture, ids.doc, seed.version, NEXT_HASH, "place", {
        metadata: {
          title: "Notes",
          place: { kind: "project", id: ids.project },
          name: "moved",
        },
      }),
    );
    // format 이름·module·명시 여부 어느 쪽을 바꿔도 계약이 바뀐다.
    for (
      const format of [
        { name: "tasks", module_hash: HASH, explicit: false },
        { name: "document", module_hash: NEXT_HASH, explicit: false },
        { name: "document", module_hash: HASH, explicit: true },
      ]
    ) {
      forbidden(
        next(fixture, ids.doc, seed.version, NEXT_HASH, `format-${format.name}`, {
          format,
        }),
      );
    }
    assertEquals(versionCount(fixture, ids.doc), 1);
    // 최신 판의 format 그대로면 저장된다.
    const saved = keep(
      next(fixture, ids.doc, seed.version, NEXT_HASH, "same-format", {
        format: { name: "document", module_hash: HASH, explicit: false },
      }),
    );
    assertEquals(saved.status, "saved");
    assertEquals(versionCount(fixture, ids.doc), 2);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 출력이 아닌 문서와 다른 assignment의 출력은 없는 문서와 같은 답이다", () => {
  const fixture = makeFixture(
    new Map([[ids.doc, ASSIGNMENT], [OTHER_DOC, OTHER_ASSIGNMENT]]),
  );
  try {
    human(fixture, ids.doc);
    const other = human(fixture, OTHER_DOC);
    const plain = human(fixture, THIRD_DOC);
    // 기준 판이 있는 저장과 새 문서 모양의 저장 모두에서 세 대상이 없는 문서와 같은 답이다.
    const shapes = (document: string, base: string | null, key: string) =>
      save(
        fixture,
        preparedInput(document, [file("a.md", true)], {
          base_version: base,
          content_hash: NEXT_HASH,
          idempotency_key: key,
          ...(base === null ? {} : { metadata: undefined }),
        }),
        operator(),
      );
    const answer = (result: ReturnType<typeof save>) =>
      result.ok ? "ok" : `${result.error.code}: ${result.error.message}`;
    const absentBased = answer(shapes(ABSENT_DOC, other.version, "a1"));
    const absentNew = answer(shapes(ABSENT_DOC, null, "a2"));
    assertEquals(absentNew.startsWith("forbidden"), true);
    for (
      const target of [
        { document: OTHER_DOC, base: other.version },
        { document: THIRD_DOC, base: plain.version },
      ]
    ) {
      assertEquals(
        answer(shapes(target.document, target.base, `b-${target.document}`)),
        absentBased,
      );
      assertEquals(
        answer(shapes(target.document, null, `n-${target.document}`)),
        absentNew,
      );
    }
    assertEquals(versionCount(fixture, OTHER_DOC), 1);
    assertEquals(versionCount(fixture, THIRD_DOC), 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/versions#R14: 판정 port가 실패하면 Operator 저장은 거절되고 Operator가 아닌 agent는 이 범위의 대상이 아니다", () => {
  const failing = versionFixture(undefined, undefined, {
    output: () => err({ code: "unavailable", message: "down" }),
  });
  try {
    const seed = human(failing, ids.doc);
    const refused = next(failing, ids.doc, seed.version, NEXT_HASH, "down");
    assert(!refused.ok);
    assertEquals(refused.error.code, "unavailable");
    // Operator가 아닌 agent(lophn 역할)는 port를 묻지 않고 일반 agent 출력으로 저장한다.
    const other = next(
      failing,
      ids.doc,
      seed.version,
      NEXT_HASH,
      "lophn",
      {},
      operator(OTHER_ASSIGNMENT, "lophn"),
    );
    assertEquals(keep(other).status, "saved");
  } finally {
    failing.close();
  }
});
