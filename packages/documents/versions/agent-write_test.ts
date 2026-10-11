// documents/versions#R14 [agent-R10]: 어느 assignment의 출력인지 documents가 알지 못한다. agent 자격
// (Operator 포함)의 저장은 역할별 저장 범위를 lophn-agent의 tool 판정에 맡기고 documents는 기준 판
// 비교와 지침 문서 금지만 지킨다. 이 fixture에는 lophn-agent가 답하는 출력 port가 등록돼 있지 않다.
import { assert, assertEquals } from "@std/assert";
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
const HASH = "ab".repeat(32);
const NEXT_HASH = "cd".repeat(32);
const SECOND_HASH = "ef".repeat(32);
const OPERATOR = "agent:asg_01arz3ndektsv4rrffq69g5fav";
const OTHER_DOC = "doc_01arz3ndektsv4rrffq69g5fax";

type Fixture = ReturnType<typeof versionFixture>;

function save(
  fixture: Fixture,
  input: ReturnType<typeof preparedInput>,
  actor: ReturnType<typeof userContext>,
) {
  return fixture.transaction((tx) =>
    commands.save.handle(tx, actor as never, input as never, {
      base_version: input.base_version,
    })
  );
}

function seed(fixture: Fixture, document: string, hash = HASH) {
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
) {
  return save(
    fixture,
    preparedInput(document, [file("a.md", true)], {
      base_version: base,
      content_hash: hash,
      metadata: undefined,
      idempotency_key: key,
    }),
    userContext(OPERATOR, ids.run),
  );
}

Deno.test("documents/versions#R14 [agent-R10]: agent 자격은 출력으로 선언된 문서가 아니어도 기존 문서에 새 판을 더하고 판 이력에 agent와 run이 남는다", () => {
  const fixture = versionFixture();
  try {
    const first = seed(fixture, ids.doc);
    const other = seed(fixture, OTHER_DOC, NEXT_HASH);
    // 두 문서 어느 것도 어떤 assignment의 출력으로 선언되지 않았다.
    const saved = keep(next(fixture, ids.doc, first.version, NEXT_HASH, "r1"));
    assertEquals(saved.status, "saved");
    const again = keep(
      next(fixture, ids.doc, saved.version, SECOND_HASH, "r2"),
    );
    assert(again.version !== saved.version);
    const elsewhere = keep(
      next(fixture, OTHER_DOC, other.version, SECOND_HASH, "r3"),
    );
    assertEquals(elsewhere.reference.document, OTHER_DOC);
    const row = fixture.sql.get(
      "SELECT saved_by, run FROM versions WHERE id = ?",
      [saved.version],
    );
    assertEquals(row?.["saved_by"], OPERATOR);
    assertEquals(row?.["run"], ids.run);
  } finally {
    fixture.close();
  }
});
