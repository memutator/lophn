// lophn-agent/harness/tool-judgment: 판정표와 비교 규칙. 순수 함수만 본다. 실제 core에서 approval을
// 만들고 허락·거절·한 번 적용하는 흐름은 apps/core/tool-judgment_test.ts가 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  type BasisSnapshot,
  type CallFacts,
  judge,
  type Origin,
  refusalKey,
  type Reversibility,
  sameBasis,
  sameLineage,
  type TargetFact,
} from "./mod.ts";

const TARGET: TargetFact = {
  id: "doc_01h455vb4pex5v6nkc6gd5fdw1",
  inScope: true,
  reversibility: "reversible",
};

function facts(over: Partial<CallFacts> = {}): CallFacts {
  return {
    identity: true,
    assignment: "active",
    run: "active",
    origin: "human_request",
    listed: true,
    roleAllows: true,
    connection: "n/a",
    inputValid: true,
    effect: "write",
    confirm: false,
    refused: false,
    targets: [TARGET],
    ...over,
  };
}

function target(
  id: string,
  over: Partial<TargetFact> = {},
): TargetFact {
  return { ...TARGET, id: `doc_01h455vb4pex5v6nkc6gd5fdw${id}`, ...over };
}

Deno.test("lophn-agent/harness/tool-judgment#R1: 판정은 allow·ask·deny 셋이고 deny는 approval이 필요한 ask와 구별된다", () => {
  assertEquals(judge(facts({ effect: "read" })).decision, "allow");
  assertEquals(
    judge(facts({ targets: [target("1", { reversibility: "irreversible" })] }))
      .decision,
    "ask",
  );
  assertEquals(judge(facts({ identity: false })).decision, "deny");
  // 모든 판정에 안전한 고정 이유가 있다.
  for (const decision of [facts(), facts({ identity: false })]) {
    assert(judge(decision).reason.trim().length > 0);
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R2: 인증·효과·입력·assignment 상태를 확인하지 못하거나 목록·역할·scope·연결 밖이면 ask가 아니라 deny다", () => {
  const unverified: [string, Partial<CallFacts>][] = [
    ["identity", { identity: false }],
    ["assignment paused", { assignment: "paused" }],
    ["assignment withdrawn", { assignment: "withdrawn" }],
    ["assignment unknown", { assignment: "unknown" }],
    ["run ended", { run: "ended" }],
    ["run unknown", { run: "unknown" }],
    ["effect unknown", { effect: null }],
    ["input invalid", { inputValid: false }],
    ["origin unknown", { origin: null }],
    ["not listed", { listed: false }],
    ["role", { roleAllows: false }],
    ["mcp connection lost", { connection: "lost" }],
    ["outside target", { targets: [target("1", { inScope: false })] }],
    ["write without targets", { targets: [] }],
  ];
  for (const [name, over] of unverified) {
    // 되돌릴 수 있는 write여도, read여도, 사람이 물을 수 있는 external이어도 열리지 않는다.
    for (const effect of ["read", "write", "external"] as const) {
      const verdict = judge(facts({ effect, ...over }));
      if (name === "write without targets" && effect === "read") continue;
      assertEquals(verdict.decision, "deny", `${name}/${effect}`);
    }
  }
  // 효과를 모르면 decision effect도 null이다.
  assertEquals(judge(facts({ effect: null })).effect, null);
});

Deno.test("lophn-agent/harness/tool-judgment#R3: 범위 안 읽기와 사람 요청·handoff의 되돌릴 수 있는 쓰기는 allow, 되돌림 없는 쓰기와 external은 ask, 주기 run의 쓰기는 deny다", () => {
  for (const origin of ["human_request", "handoff"] as const) {
    assertEquals(judge(facts({ origin, effect: "read" })).decision, "allow");
    const reversible = judge(facts({ origin }));
    assertEquals(reversible.decision, "allow");
    assertEquals(reversible.effect, "reversible_write");
  }
  const cases: Reversibility[] = ["irreversible", "unknown"];
  for (const reversibility of cases) {
    const verdict = judge(facts({ targets: [target("1", { reversibility })] }));
    assertEquals(verdict.decision, "ask", reversibility);
    assertEquals(verdict.effect, "irreversible");
  }
  assertEquals(judge(facts({ effect: "external" })).decision, "ask");
  // 표에 없는 조합(주기 run의 되돌릴 수 있는 쓰기)은 추측하지 않고 deny다.
  assertEquals(judge(facts({ origin: "periodic" })).decision, "deny");
  assertEquals(
    judge(facts({ origin: "periodic", effect: "read" })).decision,
    "allow",
  );
  // 역할 밖이면 되돌릴 수 있어도 deny다.
  assertEquals(judge(facts({ roleAllows: false })).decision, "deny");
});

Deno.test("lophn-agent/harness/tool-judgment#R5: 대상 여러 개는 deny 하나면 전체 deny, deny 없이 ask가 있으면 전체 ask, 모두 allow일 때만 allow다", () => {
  const free = target("1");
  const asks = target("2", { reversibility: "irreversible" });
  const outside = target("3", { inScope: false });
  assertEquals(judge(facts({ targets: [free, free] })).decision, "allow");
  assertEquals(judge(facts({ targets: [free, asks] })).decision, "ask");
  assertEquals(judge(facts({ targets: [asks, free] })).decision, "ask");
  assertEquals(
    judge(facts({ targets: [free, asks, outside] })).decision,
    "deny",
  );
  assertEquals(judge(facts({ targets: [outside, asks] })).decision, "deny");
  // 되돌릴 수 있는 쓰기와 주기 run의 deny가 섞이지 않게: ask와 deny가 섞이면 deny다.
  assertEquals(
    judge(facts({ origin: "periodic", targets: [free, asks] })).decision,
    "deny",
  );
});

Deno.test("lophn-agent/harness/tool-judgment#R7: 판정은 사실만 입력으로 받고 어떤 조합에서도 되돌릴 수 없는 call·confirm을 allow로 낮추는 모드가 없다", () => {
  const origins: Origin[] = ["human_request", "handoff", "periodic"];
  const reversibility: Reversibility[] = [
    "reversible",
    "irreversible",
    "unknown",
  ];
  let checked = 0;
  for (const origin of origins) {
    for (const effect of ["read", "write", "external"] as const) {
      for (const confirm of [false, true]) {
        for (const kind of reversibility) {
          const verdict = judge(facts({
            origin,
            effect,
            confirm,
            targets: [target("1", { reversibility: kind })],
          }));
          const needsHuman = confirm || effect === "external" ||
            (effect === "write" && kind !== "reversible");
          if (needsHuman) assertNotEquals(verdict.decision, "allow");
          checked += 1;
        }
      }
    }
  }
  assertEquals(checked, 54);
  // confirm=true는 read여도 호출 전에 ask다.
  assertEquals(judge(facts({ effect: "read", confirm: true })).decision, "ask");
});

Deno.test("lophn-agent/harness/tool-judgment#R9: 거절 비교는 키 순서만 무시하고 같은 run 또는 같은 원래 사람 요청 계보만 억제한다", () => {
  const base = {
    operation: "record_owned_note",
    targets: ["doc_a", "doc_b"],
    input: { a: 1, b: [1, 2], c: null },
  };
  // 객체 키 순서와 대상 집합의 순서는 무시한다.
  assertEquals(
    refusalKey(base),
    refusalKey({
      ...base,
      targets: ["doc_b", "doc_a"],
      input: { c: null, b: [1, 2], a: 1 },
    }),
  );
  // array 순서·null과 생략·타입·값·동작·대상 집합은 다른 요청이다.
  for (
    const other of [
      { ...base, input: { a: 1, b: [2, 1], c: null } },
      { ...base, input: { a: 1, b: [1, 2] } },
      { ...base, input: { a: "1", b: [1, 2], c: null } },
      { ...base, operation: "record_other" },
      { ...base, targets: ["doc_a"] },
    ]
  ) assertNotEquals(refusalKey(other), refusalKey(base));

  const message = "msg_01arz3ndektsv4rrffq69g5fa1";
  assert(
    sameLineage({ run: "run_a", origin: message }, {
      run: "run_a",
      origin: null,
    }),
  );
  assert(
    sameLineage({ run: "run_b", origin: message }, {
      run: "run_a",
      origin: message,
    }),
  );
  // 새 독립 요청은 다른 계보이고 원래 요청이 없는 주기 run은 같은 run만 같은 계보다.
  assert(
    !sameLineage({ run: "run_c", origin: "msg_other" }, {
      run: "run_a",
      origin: message,
    }),
  );
  assert(
    !sameLineage({ run: "run_b", origin: null }, {
      run: "run_a",
      origin: null,
    }),
  );
});

Deno.test("lophn-agent/harness/tool-judgment#R6: 확인한 기준이 하나라도 달라지면 옛 판정을 쓰지 않고 키 순서만 다르면 같다", () => {
  const basis: BasisSnapshot = {
    tool: "note.record",
    definition_revision: "1",
    description_hash: "d".repeat(64),
    contract_revision: "1",
    operation: "record_owned_note",
    input_hash: "e".repeat(64),
    targets: ["doc_a"],
    comparison: { basis: "current", doc: { v: 1 } },
    mcp_configuration_revision: null,
    assignment_revision: 2,
    preset_revision: 3,
  };
  const recorded = JSON.parse(JSON.stringify(basis));
  assert(sameBasis(recorded, basis));
  assert(
    sameBasis(
      {
        preset_revision: 3,
        assignment_revision: 2,
        mcp_configuration_revision: null,
        comparison: { doc: { v: 1 }, basis: "current" },
        targets: ["doc_a"],
        input_hash: "e".repeat(64),
        operation: "record_owned_note",
        contract_revision: "1",
        description_hash: "d".repeat(64),
        definition_revision: "1",
        tool: "note.record",
      },
      basis,
    ),
  );
  const changed: Partial<BasisSnapshot>[] = [
    { tool: "note.other" },
    { definition_revision: "2" },
    { description_hash: "f".repeat(64) },
    { contract_revision: "2" },
    { operation: "record_other" },
    { input_hash: "f".repeat(64) },
    { targets: ["doc_a", "doc_b"] },
    { comparison: { basis: "stale" } },
    { mcp_configuration_revision: 4 },
    { assignment_revision: 3 },
    { preset_revision: 4 },
  ];
  for (const over of changed) {
    assert(!sameBasis(recorded, { ...basis, ...over }), JSON.stringify(over));
  }
  // 기록이 없거나 모양이 다르면 옛 허락을 쓰지 않는다.
  assert(!sameBasis(null, basis));
  assert(!sameBasis("basis", basis));
});
