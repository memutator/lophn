// lophn-agent/harness/tool-judgment: 판정표와 비교 규칙. 순수 함수만 본다. 실제 core에서 approval을
// 만들고 허락·거절·한 번 적용하는 흐름은 apps/core/tool-judgment_test.ts가 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  type BasisSnapshot,
  type CallFacts,
  judge,
  lowerBySessionGrant,
  type Origin,
  refusalKey,
  type Reversibility,
  sameBasis,
  sameLineage,
  sameToolBasis,
  type TargetFact,
} from "./mod.ts";

const TARGET: TargetFact = {
  id: "doc_01h455vb4pex5v6nkc6gd5fdw1",
  inScope: true,
  declared: true,
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

Deno.test("lophn-agent/harness/tool-judgment#R3: 범위 안 읽기와 사람 요청·handoff의 되돌릴 수 있는 쓰기는 allow, 되돌림 없는 쓰기와 external은 ask다", () => {
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
  // 역할 밖이면 되돌릴 수 있어도 deny다.
  assertEquals(judge(facts({ roleAllows: false })).decision, "deny");
});

Deno.test("lophn-agent/harness/tool-judgment#R4: 주기 run은 선언된 남길 문서의 새 version만 allow로 저장하고 선언 밖 쓰기는 approval request 없이 거절된다", () => {
  // 선언된 남길 문서의 쓰기는 재확인 없이 allow다(R4).
  assertEquals(judge(facts({ origin: "periodic" })).decision, "allow");
  assertEquals(
    judge(facts({ origin: "periodic" })).effect,
    "reversible_write",
  );
  // 선언 밖 문서 쓰기는 ask가 아니라 deny다(R4).
  assertEquals(
    judge(facts({
      origin: "periodic",
      targets: [target("2", { declared: false })],
    })).decision,
    "deny",
  );
  // 주기 run의 읽기는 여전히 allow다(R4).
  assertEquals(
    judge(facts({ origin: "periodic", effect: "read" })).decision,
    "allow",
  );
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
  // 되돌릴 수 있는 쓰기와 주기 run의 deny가 섞이지 않게: 선언 안 된 대상이 섞이면 deny다.
  assertEquals(
    judge(facts({
      origin: "periodic",
      targets: [target("1", { declared: false })],
    })).decision,
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
    agent_hash: "a".repeat(64),
  };
  const recorded = JSON.parse(JSON.stringify(basis));
  assert(sameBasis(recorded, basis));
  assert(
    sameBasis(
      {
        agent_hash: "a".repeat(64),
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
    { agent_hash: "b".repeat(64) },
  ];
  for (const over of changed) {
    assert(!sameBasis(recorded, { ...basis, ...over }), JSON.stringify(over));
  }
  // 기록이 없거나 모양이 다르면 옛 허락을 쓰지 않는다.
  assert(!sameBasis(null, basis));
  assert(!sameBasis("basis", basis));
});

// session 허락은 ask를 allow로 낮추는 한 칸이다. 그 밖의 칸은 그대로다(R14).
function lowered(over: Partial<CallFacts> = {}) {
  const input = facts(over);
  return lowerBySessionGrant(input, judge(input));
}

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: session 허락은 ask로 판정될 호출을 새 approval request 없이 allow로 낮춘다", () => {
  const asking: Partial<CallFacts>[] = [
    { targets: [target("1", { reversibility: "irreversible" })] },
    { targets: [target("1", { reversibility: "unknown" })] },
    { effect: "external" },
    // 대상 여러 개: ask가 하나라도 있으면 전체가 ask였다가 전체가 allow로 낮아진다.
    {
      targets: [target("1"), target("2", { reversibility: "irreversible" })],
    },
  ];
  for (const over of asking) {
    assertEquals(judge(facts(over)).decision, "ask");
    const result = lowered(over);
    assertEquals(result.decision, "allow");
    assertEquals(result.code, "session_granted");
    assert(result.reason.trim().length > 0);
    // 효과 판정은 그대로다: 되돌릴 수 없는 호출이 되돌릴 수 있는 호출이 되지 않는다.
    assertEquals(result.effect, judge(facts(over)).effect);
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: deny와 거절 억제와 confirm 앱 command는 session 허락으로 낮아지지 않는다", () => {
  const irreversible = [target("1", { reversibility: "irreversible" })];
  // 거절은 session 허락보다 앞선다: 같은 동작을 Deny한 뒤에는 허락이 있어도 deny다.
  const refused = lowered({ targets: irreversible, refused: true });
  assertEquals(refused.decision, "deny");
  assertEquals(refused.code, "refused_before");
  const denied: Partial<CallFacts>[] = [
    { identity: false },
    { assignment: "paused" },
    { run: "ended" },
    { listed: false },
    { roleAllows: false },
    { connection: "lost", effect: "external" },
    { targets: [target("1", { inScope: false })] },
    {
      targets: [
        target("1", { reversibility: "irreversible" }),
        target("2", { inScope: false }),
      ],
    },
  ];
  for (const over of denied) {
    assertEquals(lowered(over).decision, "deny", JSON.stringify(over));
  }
  // confirm=true는 read여도 호출마다 사람이 정한다.
  for (const effect of ["read", "write", "external"] as const) {
    const result = lowered({ effect, confirm: true });
    assertEquals(result.decision, "ask", effect);
    assertEquals(result.code, "confirm_required");
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: ask가 아닌 판정은 그대로 둔다", () => {
  for (const over of [{ effect: "read" as const }, {}]) {
    const before = judge(facts(over));
    assertEquals(before.decision, "allow");
    assertEquals(lowered(over), before);
  }
});

Deno.test("lophn-agent/harness/tool-judgment#R14 [agent-I14]: 같은 tool의 비교는 계약·정의·연결·agent hash만 보고 대상·입력은 보지 않는다", () => {
  const recorded: BasisSnapshot = {
    tool: "document.remove",
    definition_revision: "tools-1",
    description_hash: "aa".repeat(32),
    contract_revision: "documents-1",
    operation: "document.remove",
    input_hash: "bb".repeat(32),
    targets: ["doc_01h455vb4pex5v6nkc6gd5fdw1"],
    comparison: { seq: "41" },
    mcp_configuration_revision: 4,
    agent_hash: "a".repeat(64),
  };
  assert(sameToolBasis(recorded, recorded));
  // 대상·입력·비교 기준이 달라도 같은 tool이다.
  assert(sameToolBasis(recorded, {
    ...recorded,
    input_hash: "cc".repeat(32),
    targets: ["doc_01h455vb4pex5v6nkc6gd5fdw2"],
    comparison: { seq: "99" },
  }));
  const changes: Partial<BasisSnapshot>[] = [
    { tool: "document.archive" },
    { operation: "document.move" },
    { definition_revision: "tools-2" },
    { description_hash: "dd".repeat(32) },
    { contract_revision: "documents-2" },
    { mcp_configuration_revision: 5 },
    { mcp_configuration_revision: null },
    { agent_hash: "b".repeat(64) },
  ];
  for (const change of changes) {
    assert(
      !sameToolBasis(recorded, { ...recorded, ...change }),
      JSON.stringify(change),
    );
  }
  for (const broken of [null, undefined, "x", 1, [], {}]) {
    assert(!sameToolBasis(broken, recorded));
  }
  // 옛 assignment·preset 판 칸은 기준에서 빠졌다. 있어도 비교하지 않고, agent hash가 없으면 같은 tool이 아니다.
  assert(
    sameToolBasis(
      { ...recorded, assignment_revision: 9, preset_revision: 9 },
      recorded,
    ),
  );
  const { agent_hash: _dropped, ...withoutAgent } = recorded;
  assert(!sameToolBasis(withoutAgent, recorded));
});
