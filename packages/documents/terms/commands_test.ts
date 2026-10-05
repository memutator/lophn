import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  TERM_EVENTS,
  termDefine,
  termProposeInputSchema,
} from "../../contracts/documents/mod.ts";
import type { TermEvidence } from "../../contracts/documents/mod.ts";
import type { TargetAuthorizer } from "../../contracts/platform/mod.ts";
import { contextFixture } from "../contexts/testing/mod.ts";
import { createContextCommands } from "../contexts/mod.ts";
import { createTermCommands } from "./commands.ts";
import {
  checkTermOccurrence,
  createDerivedEvidenceSource,
} from "./occurrence.ts";
import {
  derivedFixture,
  ids,
  keep,
  termFixture,
  userContext,
} from "./testing/mod.ts";

const commands = createTermCommands();
const AGENT = `agent:${ids.run.replace("run_", "asg_")}`;

function agent() {
  return userContext(AGENT, ids.run);
}

function section(version = ids.version1, key = "요약"): TermEvidence {
  return {
    document: ids.doc,
    version,
    section: key,
    start_line: null,
    end_line: null,
  };
}

function lines(version = ids.version1, start = 2, end = 3): TermEvidence {
  return {
    document: ids.doc,
    version,
    section: null,
    start_line: start,
    end_line: end,
  };
}

// 다른 leaf의 fixture는 이 *_test.ts가 만들어 넘긴다.
const newFixture = (authorize?: TargetAuthorizer) =>
  termFixture(contextFixture(authorize));
type Fixture = ReturnType<typeof newFixture>;

// 문서 하나와 그 첫 판, context 둘이 있는 ledger.
function setup(authorize?: TargetAuthorizer): Fixture {
  const fixture = newFixture(authorize);
  fixture.seedContext(ids.context);
  fixture.seedContext(ids.context2);
  fixture.seedDocument(ids.doc);
  fixture.seedVersion(ids.doc, ids.version1, 1);
  return fixture;
}

function propose(
  fixture: Fixture,
  term: string,
  name: string,
  evidence: readonly TermEvidence[] = [section()],
  actor = agent(),
  context = ids.context,
) {
  return fixture.transaction((tx) =>
    commands.propose.handle(
      tx,
      actor,
      { id: term, context, name, evidence } as never,
      {},
    )
  );
}

function define(
  fixture: Fixture,
  input: Record<string, unknown>,
  base?: string,
  actor = userContext(),
) {
  // 새 등록은 비교할 revision이 없다. 이미 있는 용어는 base_revision을 보낸다.
  const compare = base === undefined ? {} : { base_revision: base };
  return fixture.transaction((tx) =>
    commands.define.handle(tx, actor, input as never, compare)
  );
}

function update(
  fixture: Fixture,
  term: string,
  fields: Record<string, unknown>,
  base: string,
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.update.handle(
      tx,
      actor,
      { term, ...fields } as never,
      { base_revision: base },
    )
  );
}

function archive(
  fixture: Fixture,
  term: string,
  base: string,
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.archive.handle(tx, actor, { term } as never, {
      base_revision: base,
    })
  );
}

function unarchive(
  fixture: Fixture,
  term: string,
  base: string,
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.unarchive.handle(tx, actor, { term } as never, {
      base_revision: base,
    })
  );
}

function code(result: { ok: boolean; error?: { code: string } }): string {
  assert(!result.ok);
  return result.error?.code ?? "";
}

Deno.test("documents/terms#R1: agent 후보는 고정 판의 section·줄 범위 근거를 남기고 정의 없는 후보다", () => {
  const fixture = setup();
  try {
    const bySection = keep(propose(fixture, ids.term(1), "범위", [section()]));
    assertEquals(bySection.definition, null);
    assertEquals(bySection.status, "active");
    assertEquals(bySection.evidence, [section()]);
    const byLines = keep(
      propose(fixture, ids.term(2), "판", [lines(), section(ids.version1)]),
    );
    assertEquals(byLines.evidence.length, 2);
    assertEquals(byLines.evidence[0].start_line, 2);
    assertEquals(byLines.evidence[0].end_line, 3);
    assertEquals(fixture.emitted.map((event) => event.type), [
      "TermProposed",
      "TermProposed",
    ]);
    // 낸 event payload는 contract schema를 지킨다.
    for (const event of fixture.emitted) {
      const declared = TERM_EVENTS.find((item) => item.type === event.type);
      assert(declared?.payload.safeParse(event.payload).success);
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R1: 새 문서 판이 생겨도 후보 근거는 당시 고정 판을 그대로 가리킨다", () => {
  const fixture = setup();
  try {
    const candidate = keep(propose(fixture, ids.term(1), "범위"));
    // 같은 문서의 새 판이 저장되어 최신 판이 바뀐다.
    fixture.seedVersion(ids.doc, ids.version2, 2);
    fixture.db.prepare(`UPDATE documents SET latest_version = ? WHERE id = ?`)
      .run(ids.version2, ids.doc);
    const row = fixture.db.prepare(
      `SELECT version FROM term_evidence WHERE term = ?`,
    ).get(candidate.id) as { version: string };
    assertEquals(row.version, ids.version1);
    // 이름만 바꾸는 수정도 근거를 최신 판으로 바꿔치기하지 않는다.
    const renamed = keep(
      update(
        fixture,
        ids.term(1),
        { name: "범위 2" },
        candidate.revision,
        agent(),
      ),
    );
    assertEquals(renamed.evidence, [section(ids.version1)]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R1: 근거 없는 agent 후보와 고정 판을 못 찾는 근거는 거절되고 아무것도 남지 않는다", () => {
  const fixture = setup();
  try {
    fixture.seedDocument(ids.doc2);
    fixture.seedVersion(ids.doc2, ids.version3, 1);
    // route 입력 schema는 근거 없음·위치 없음을 먼저 거절한다.
    const base = {
      id: ids.term(1),
      context: ids.context,
      name: "범위",
    };
    assert(
      !termProposeInputSchema.safeParse({ ...base, evidence: [] }).success,
    );
    assert(
      !termProposeInputSchema.safeParse({
        ...base,
        evidence: [{ ...section(), section: null }],
      }).success,
    );
    // handler도 같은 규칙을 지킨다(schema를 건너뛴 입력).
    assertEquals(
      code(propose(fixture, ids.term(1), "범위", [])),
      "invalid_input",
    );
    assertEquals(
      code(
        propose(fixture, ids.term(1), "범위", [{
          ...section(),
          section: null,
        }]),
      ),
      "invalid_input",
    );
    // 없는 판, 다른 문서의 판, 없는 문서는 모두 invalid_input이다.
    assertEquals(
      code(propose(fixture, ids.term(1), "범위", [
        section("ver_01arz3ndektsv4rrffq69g5fzz"),
      ])),
      "invalid_input",
    );
    assertEquals(
      code(propose(fixture, ids.term(1), "범위", [section(ids.version3)])),
      "invalid_input",
    );
    assertEquals(
      code(propose(fixture, ids.term(1), "범위", [{
        ...section(),
        document: "doc_01arz3ndektsv4rrffq69g5fzz",
      }])),
      "invalid_input",
    );
    // 없는 context와 이미 있는 term id.
    assertEquals(
      code(propose(
        fixture,
        ids.term(1),
        "범위",
        [section()],
        agent(),
        ids.context3,
      )),
      "not_found",
    );
    // run 없는 agent의 제출은 미완성 제출이다.
    assertEquals(
      code(
        propose(fixture, ids.term(1), "범위", [section()], userContext(AGENT)),
      ),
      "invalid_input",
    );
    // 거절은 event도 행도 남기지 않는다.
    assertEquals(fixture.emitted.length, 0);
    assertEquals(
      (fixture.db.prepare(`SELECT count(*) AS n FROM terms`).get() as {
        n: number;
      })
        .n,
      0,
    );
    // 사람이 낸 제안도 같은 근거 규칙이다.
    assertEquals(
      code(propose(fixture, ids.term(1), "범위", [], userContext())),
      "invalid_input",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R1: 권한 밖 문서의 근거는 없는 문서와 같은 invalid_input이다", () => {
  const hidden: TargetAuthorizer = (_ctx, _operation, target) =>
    "document" in target
      ? err({ code: "forbidden", message: "out of scope" })
      : ok(undefined);
  const fixture = setup(hidden);
  try {
    const result = propose(fixture, ids.term(1), "범위");
    assertEquals(code(result), "invalid_input");
    assertEquals(
      !result.ok && result.error.message,
      "term evidence needs a stored fixed version",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R1: route는 command 앞에서 고정 판의 section·줄 범위에 이름이 실제로 나오는지 확인한다(Q8)", () => {
  const derived = derivedFixture();
  try {
    derived.extract(
      ids.doc,
      ids.version1,
      [
        "# 제목",
        "범위는 이번 판단의 대상이다",
        "본문",
        "## 요약",
        "요약 안의 용어 판",
      ].join("\n"),
      [
        { key: "제목", start: 1, end: 3 },
        { key: "요약", start: 4, end: 5 },
      ],
    );
    derived.extract(ids.doc, ids.version2, "", [], "unverified");
    derived.extract(ids.doc, ids.version3, "", [], "failed");
    const source = createDerivedEvidenceSource(derived.sql);
    const check = (name: string, evidence: TermEvidence[]) =>
      checkTermOccurrence(source, name, evidence);
    // section 본문과 줄 범위에서 이름이 나오면 통과한다.
    assert(check("판", [section(ids.version1, "요약")]).ok);
    assert(check("범위", [lines(ids.version1, 2, 2)]).ok);
    assert(check("범위", [section(ids.version1, "제목")]).ok);
    // 그 section·범위에 없는 이름은 거절한다(다른 section에 있어도 아니다).
    assertEquals(
      code(check("범위", [section(ids.version1, "요약")])),
      "invalid_input",
    );
    assertEquals(
      code(check("용어", [lines(ids.version1, 2, 3)])),
      "invalid_input",
    );
    // 이름 비교는 정확한 문자열이다.
    assertEquals(
      code(check("용어 판 ", [section(ids.version1, "요약")])),
      "invalid_input",
    );
    // 없는 key, 본문 밖 범위, 추출 미완료·실패 판은 읽을 수 없다. 최신 판으로 대신하지 않는다.
    assertEquals(
      code(check("판", [section(ids.version1, "없는 key")])),
      "invalid_input",
    );
    assertEquals(
      code(check("판", [lines(ids.version1, 5, 9)])),
      "invalid_input",
    );
    assertEquals(
      code(check("판", [section(ids.version2, "요약")])),
      "invalid_input",
    );
    assertEquals(
      code(check("판", [lines(ids.version3, 1, 1)])),
      "invalid_input",
    );
    assertEquals(
      code(check("판", [lines("ver_01arz3ndektsv4rrffq69g5fzz", 1, 1)])),
      "invalid_input",
    );
    // 근거가 없거나 위치가 없으면 거절이다. 여러 근거는 모두 나와야 한다.
    assertEquals(code(check("판", [])), "invalid_input");
    assertEquals(
      code(check("판", [{ ...section(), section: null }])),
      "invalid_input",
    );
    assertEquals(
      code(
        check("범위", [
          lines(ids.version1, 2, 2),
          section(ids.version1, "요약"),
        ]),
      ),
      "invalid_input",
    );
  } finally {
    derived.close();
  }
});

Deno.test("documents/terms#R2: agent의 정의 확정과 정의된 용어의 이름·뜻 수정은 거절되고 후보 이름·근거만 다룬다", () => {
  const fixture = setup();
  try {
    const candidate = keep(propose(fixture, ids.term(1), "범위"));
    // route actor는 user뿐이고 handler도 agent·machine을 forbidden으로 막는다.
    assertEquals(termDefine.actors, ["user"]);
    for (
      const actor of [
        agent(),
        userContext("machine"),
        userContext("coding_agent:cda_01arz3ndektsv4rrffq69g5fav"),
      ]
    ) {
      assertEquals(
        code(define(
          fixture,
          {
            term: ids.term(1),
            name: "범위",
            definition: "이번 판단의 대상",
          },
          candidate.revision,
          actor,
        )),
        "forbidden",
      );
    }
    // agent가 update에 definition을 넣으면 forbidden이다(후보여도).
    assertEquals(
      code(
        update(
          fixture,
          ids.term(1),
          { definition: "뜻" },
          candidate.revision,
          agent(),
        ),
      ),
      "forbidden",
    );
    // 후보의 이름·근거는 agent가 바꾼다.
    const renamed = keep(
      update(
        fixture,
        ids.term(1),
        {
          name: "판단 범위",
          evidence: [section(), lines()],
        },
        candidate.revision,
        agent(),
      ),
    );
    assertEquals(renamed.name, "판단 범위");
    assertEquals(renamed.evidence.length, 2);
    assertEquals(renamed.definition, null);
    // 후보 근거는 위치 없는 근거로 바꿀 수 없다.
    assertEquals(
      code(update(
        fixture,
        ids.term(1),
        {
          evidence: [{ ...section(), section: null }],
        },
        renamed.revision,
        agent(),
      )),
      "invalid_input",
    );
    // 사람의 정의가 서면 agent는 이름도 근거도 바꾸지 못한다.
    const defined = keep(define(fixture, {
      term: ids.term(1),
      name: "판단 범위",
      definition: "이번 판단의 대상",
    }, renamed.revision));
    assertEquals(
      code(
        update(
          fixture,
          ids.term(1),
          { name: "다른 이름" },
          defined.revision,
          agent(),
        ),
      ),
      "forbidden",
    );
    assertEquals(
      code(
        update(
          fixture,
          ids.term(1),
          { evidence: [lines()] },
          defined.revision,
          agent(),
        ),
      ),
      "forbidden",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R2: 사람이 후보를 정의하면 그 사람의 결정으로 반영되고 새 용어를 직접 정의할 수도 있다", () => {
  const fixture = setup();
  try {
    const candidate = keep(propose(fixture, ids.term(1), "범위"));
    // 오래된 base_revision은 conflict, 이름 변경이 섞인 정의는 invalid_input이다.
    assertEquals(
      code(
        define(
          fixture,
          { term: ids.term(1), name: "범위", definition: "뜻" },
          "999",
        ),
      ),
      "conflict",
    );
    assertEquals(
      code(
        define(
          fixture,
          { term: ids.term(1), name: "다른", definition: "뜻" },
          candidate.revision,
        ),
      ),
      "invalid_input",
    );
    assertEquals(
      code(define(fixture, {
        term: ids.term(1),
        name: "범위",
        definition: "뜻",
        evidence: [],
      }, candidate.revision)),
      "invalid_input",
    );
    const defined = keep(define(fixture, {
      term: ids.term(1),
      name: "범위",
      definition: "이번 판단의 대상",
    }, candidate.revision));
    assertEquals(defined.definition, "이번 판단의 대상");
    assertEquals(defined.evidence, candidate.evidence);
    const event = fixture.emitted.at(-1);
    assertEquals(event?.type, "TermDefined");
    assertEquals(event?.payload, {
      context: ids.context,
      name: "범위",
      before_definition: null,
      definition: "이번 판단의 대상",
      before_revision: candidate.revision,
    });
    // 이미 정의된 용어의 재정의는 define이 아니라 update다.
    assertEquals(
      code(
        define(fixture, {
          term: ids.term(1),
          name: "범위",
          definition: "다른 뜻",
        }, defined.revision),
      ),
      "conflict",
    );
    const updated = keep(
      update(
        fixture,
        ids.term(1),
        { definition: "고친 뜻", name: "범위 판단" },
        defined.revision,
      ),
    );
    assertEquals(updated.definition, "고친 뜻");
    assertEquals(fixture.emitted.at(-1)?.payload, {
      before: { name: "범위", definition: "이번 판단의 대상" },
      after: { name: "범위 판단", definition: "고친 뜻" },
      before_revision: defined.revision,
    });
    // 후보 없이 사람이 새 용어를 정의한다. 근거는 비어 있어도 된다.
    const direct = keep(define(fixture, {
      id: ids.term(2),
      context: ids.context,
      name: "직접",
      definition: "바로 정의",
    }));
    assertEquals(direct.evidence, []);
    assertEquals(fixture.emitted.at(-1)?.payload, {
      context: ids.context,
      name: "직접",
      before_definition: null,
      definition: "바로 정의",
      before_revision: null,
    });
    // 후보에 뜻을 주는 update와 아무것도 바꾸지 않는 update는 거절이다.
    const other = keep(propose(fixture, ids.term(3), "후보"));
    assertEquals(
      code(update(fixture, ids.term(3), { definition: "뜻" }, other.revision)),
      "invalid_input",
    );
    assertEquals(
      code(update(fixture, ids.term(3), { name: "후보" }, other.revision)),
      "invalid_input",
    );
    for (const event of fixture.emitted) {
      const declared = TERM_EVENTS.find((item) => item.type === event.type);
      assert(declared?.payload.safeParse(event.payload).success, event.type);
    }
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R2: CE agent run의 후보 변경만 이후 revision이 그대로일 때 되돌릴 수 있고 사람 정의는 되돌리는 command가 없다", () => {
  const fixture = setup();
  try {
    // run이 제안한 후보는 revision이 그대로면 보관으로 보상된다.
    const proposed = keep(propose(fixture, ids.term(1), "범위"));
    const compensated = keep(archive(fixture, ids.term(1), proposed.revision));
    assertEquals(compensated.status, "archived");
    // 이후 사람이 후보를 고쳤다면 같은 보상은 conflict다.
    const second = keep(propose(fixture, ids.term(2), "판"));
    const touched = keep(
      update(fixture, ids.term(2), { name: "판 2" }, second.revision),
    );
    assertEquals(touched.status, "active");
    assertEquals(
      code(archive(fixture, ids.term(2), second.revision)),
      "conflict",
    );
    // run이 후보 이름을 바꾼 변경은 event의 before 값으로 같은 CAS 아래 되돌린다.
    const third = keep(propose(fixture, ids.term(3), "원래"));
    const renamed = keep(
      update(fixture, ids.term(3), { name: "바뀜" }, third.revision, agent()),
    );
    const event = fixture.emitted.at(-1) as {
      payload: { before: { name: string } };
    };
    const reverted = keep(
      update(
        fixture,
        ids.term(3),
        { name: event.payload.before.name },
        renamed.revision,
      ),
    );
    assertEquals(reverted.name, "원래");
    // 사람의 정의는 정의를 지우거나 후보로 돌리는 요청이 없다. 입력이 null을
    // 담아도 handler가 거절하고 뜻은 그대로다.
    const defined = keep(define(fixture, {
      id: ids.term(4),
      context: ids.context,
      name: "정의",
      definition: "사람의 뜻",
    }));
    assertEquals(
      code(
        update(fixture, ids.term(4), { definition: null }, defined.revision),
      ),
      "invalid_input",
    );
    const stored = fixture.db.prepare(
      `SELECT definition FROM terms WHERE id = ?`,
    ).get(ids.term(4)) as { definition: string };
    assertEquals(stored.definition, "사람의 뜻");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R3: context마다 같은 이름을 따로 정의하고 후보를 자동으로 정의하거나 합치지 않는다", () => {
  const fixture = setup();
  try {
    const first = keep(define(fixture, {
      id: ids.term(1),
      context: ids.context,
      name: "범위",
      definition: "판단 대상",
    }));
    // 다른 context의 같은 이름은 다른 정의를 남긴다. 합치거나 상속하지 않는다.
    const second = keep(define(fixture, {
      id: ids.term(2),
      context: ids.context2,
      name: "범위",
      definition: "출력 범위",
    }));
    assertEquals(first.definition, "판단 대상");
    assertEquals(second.definition, "출력 범위");
    assertEquals(first.context, ids.context);
    assertEquals(second.context, ids.context2);
    // 정의가 없는 context의 같은 이름 후보는 정의로 바뀌지 않고 후보로 남는다.
    fixture.seedContext(ids.context3);
    const candidate = keep(
      propose(fixture, ids.term(3), "범위", [section()], agent(), ids.context3),
    );
    assertEquals(candidate.definition, null);
    assertEquals(candidate.context, ids.context3);
    // 다른 context의 정의는 그대로다.
    const rows = fixture.db.prepare(
      `SELECT context, definition FROM terms ORDER BY id`,
    ).all() as { context: string; definition: string | null }[];
    assertEquals(rows.map((row) => row.definition), [
      "판단 대상",
      "출력 범위",
      null,
    ]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R3: 같은 context의 active 이름은 정확한 문자열일 때만 겹치고 보관하면 이름을 다시 쓴다", () => {
  const fixture = setup();
  try {
    const first = keep(define(fixture, {
      id: ids.term(1),
      context: ids.context,
      name: "범위",
      definition: "판단 대상",
    }));
    const clash = (id: number, name: string) =>
      define(fixture, {
        id: ids.term(id),
        context: ids.context,
        name,
        definition: `${name}의 뜻`,
      });
    assertEquals(code(clash(2, "범위")), "conflict");
    assertEquals(
      code(propose(fixture, ids.term(3), "범위", [section()], agent())),
      "conflict",
    );
    // 공백·대소문자·Unicode 정규화가 다르면 다른 이름이다. 별칭으로 합치지 않는다.
    const decomposed = "범위".normalize("NFD");
    assert(decomposed !== "범위");
    for (
      const [index, name] of ["범위 ", "Scope", "scope", decomposed].entries()
    ) {
      keep(clash(10 + index, name));
    }
    // 보관한 이름은 다시 쓸 수 있고, 그 사이 쓰인 이름은 해제할 수 없다.
    const archived = keep(archive(fixture, ids.term(1), first.revision));
    keep(clash(20, "범위"));
    assertEquals(
      code(unarchive(fixture, ids.term(1), archived.revision)),
      "conflict",
    );
    // 이름을 바꾸는 update도 활성 이름과 겹치면 conflict다.
    const other = keep(propose(fixture, ids.term(21), "다른"));
    assertEquals(
      code(update(fixture, ids.term(21), { name: "Scope" }, other.revision)),
      "conflict",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R5: 용어 보관은 정의·근거를 지우지 않고 정의를 후보로 돌리는 경로가 없다", () => {
  const fixture = setup();
  try {
    const candidate = keep(propose(fixture, ids.term(1), "후보", [lines()]));
    const defined = keep(define(fixture, {
      id: ids.term(2),
      context: ids.context,
      name: "정의",
      definition: "사람의 뜻",
      evidence: [section()],
    }));
    const archivedCandidate = keep(
      archive(fixture, ids.term(1), candidate.revision, agent()),
    );
    const archivedDefined = keep(
      archive(fixture, ids.term(2), defined.revision),
    );
    assertEquals(archivedCandidate.status, "archived");
    assertEquals(archivedCandidate.evidence, candidate.evidence);
    assertEquals(archivedDefined.status, "archived");
    assertEquals(archivedDefined.definition, "사람의 뜻");
    assertEquals(archivedDefined.evidence, [section()]);
    // 보관한 용어는 고치지 못하고 다시 해제한 뒤에야 고친다.
    assertEquals(
      code(
        update(
          fixture,
          ids.term(2),
          { definition: "다른" },
          archivedDefined.revision,
        ),
      ),
      "conflict",
    );
    assertEquals(
      code(archive(fixture, ids.term(2), archivedDefined.revision)),
      "conflict",
    );
    const restored = keep(
      unarchive(fixture, ids.term(2), archivedDefined.revision),
    );
    assertEquals(restored.status, "active");
    assertEquals(restored.definition, "사람의 뜻");
    assertEquals(restored.evidence, [section()]);
    assertEquals(
      code(unarchive(fixture, ids.term(2), restored.revision)),
      "conflict",
    );
    // 정의를 지우는 요청은 schema에도 handler에도 표에도 없다.
    for (
      const bad of [{ definition: null }, { definition: "" }, {
        definition: "  ",
      }]
    ) {
      assertEquals(
        code(update(fixture, ids.term(2), bad, restored.revision)),
        "invalid_input",
      );
    }
    assertThrowsSql(
      fixture,
      `UPDATE terms SET definition = NULL WHERE id = '${ids.term(2)}'`,
    );
    assertThrowsSql(fixture, `DELETE FROM terms WHERE id = '${ids.term(2)}'`);
    const stored = fixture.db.prepare(
      `SELECT definition FROM terms WHERE id = ?`,
    ).get(ids.term(2)) as { definition: string };
    assertEquals(stored.definition, "사람의 뜻");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R5: context를 보관해도 용어와 근거는 그대로다", () => {
  const fixture = setup();
  try {
    keep(propose(fixture, ids.term(1), "후보"));
    keep(define(fixture, {
      id: ids.term(2),
      context: ids.context,
      name: "정의",
      definition: "사람의 뜻",
      evidence: [lines()],
    }));
    const before = snapshotOfTerms(fixture);
    const contexts = createContextCommands();
    const archived = keep(
      fixture.transaction((tx) =>
        contexts.archive.handle(
          tx,
          userContext(),
          { context: ids.context } as never,
          { base_revision: "1" },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    assertEquals(snapshotOfTerms(fixture), before);
    assertEquals(fixture.emitted.at(-1)?.type, "ContextArchived");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R6: 앱 read command를 항목으로 가진 context의 용어를 정의해도 다른 표는 바뀌지 않고 blueprint로 복사되지 않는다", () => {
  const fixture = setup();
  try {
    // 앱 read command를 항목으로 가진 context의 용어를 정의한다.
    const contexts = createContextCommands({
      appCommand: (_app, command) => command.startsWith("read_"),
    });
    keep(
      fixture.transaction((tx) =>
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
      ),
    );
    const tables = () =>
      fixture.db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      ).all().map((row) => (row as { name: string }).name);
    const dump = () =>
      Object.fromEntries(
        tables()
          .filter((name) => name !== "terms" && name !== "term_evidence")
          .map((name) => [
            name,
            JSON.stringify(
              fixture.db.prepare(`SELECT * FROM "${name}"`).all(),
              (_key, value) =>
                typeof value === "bigint" ? Number(value) : value,
            ),
          ]),
      );
    const before = dump();
    keep(define(fixture, {
      id: ids.term(1),
      context: ids.context3,
      name: "노트",
      definition: "앱이 다루는 글",
    }));
    keep(
      propose(fixture, ids.term(2), "후보", [section()], agent(), ids.context3),
    );
    // 용어를 정의·제안해도 context·문서·판 등 다른 표는 바뀌지 않는다.
    assertEquals(dump(), before);
  } finally {
    fixture.close();
  }
});

function assertThrowsSql(fixture: Fixture, statement: string): void {
  let thrown = false;
  try {
    fixture.db.exec(statement);
  } catch {
    thrown = true;
  }
  assert(thrown, statement);
}

function snapshotOfTerms(fixture: Fixture): string {
  return JSON.stringify([
    fixture.db.prepare(`SELECT * FROM terms ORDER BY id`).all(),
    fixture.db.prepare(`SELECT * FROM term_evidence ORDER BY term, position`)
      .all(),
  ], (_key, value) => typeof value === "bigint" ? Number(value) : value);
}

Deno.test("documents/terms#R1: 범위 밖 context는 없는 context와 같은 not_found이고 아무것도 남지 않는다", () => {
  const scoped: TargetAuthorizer = (_ctx, _operation, target) =>
    "context" in target && target.context === ids.context2
      ? err({ code: "forbidden", message: "out of scope" })
      : ok(undefined);
  const fixture = setup(scoped);
  try {
    const hidden = propose(
      fixture,
      ids.term(1),
      "범위",
      [section()],
      agent(),
      ids.context2,
    );
    const absent = propose(
      fixture,
      ids.term(1),
      "범위",
      [section()],
      agent(),
      ids.context3,
    );
    assertEquals(code(hidden), "not_found");
    assertEquals(!hidden.ok && hidden.error, !absent.ok && absent.error);
    assertEquals(
      code(define(fixture, {
        id: ids.term(2),
        context: ids.context2,
        name: "범위",
        definition: "뜻",
      })),
      "not_found",
    );
    assertEquals(fixture.emitted.length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/terms#R2: 새 용어 정의는 base_revision 없이, 이미 있는 용어 정의는 base_revision과 함께만 받는다", () => {
  const fixture = setup();
  try {
    const candidate = keep(propose(fixture, ids.term(1), "후보"));
    // 이미 있는 용어는 base_revision이 없으면 거절이다(CAS를 건너뛰지 못한다).
    assertEquals(
      code(
        define(fixture, { term: ids.term(1), name: "후보", definition: "뜻" }),
      ),
      "invalid_input",
    );
    // 새 등록에 revision을 꾸며 보내면 거절이다.
    assertEquals(
      code(define(fixture, {
        id: ids.term(2),
        context: ids.context,
        name: "새 용어",
        definition: "뜻",
      }, "1")),
      "invalid_input",
    );
    assertEquals(fixture.emitted.length, 1);
    keep(define(fixture, {
      id: ids.term(2),
      context: ids.context,
      name: "새 용어",
      definition: "뜻",
    }));
    keep(define(fixture, {
      term: ids.term(1),
      name: "후보",
      definition: "뜻",
    }, candidate.revision));
  } finally {
    fixture.close();
  }
});
