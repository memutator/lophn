// lophn-agent/roles/operator#R7 [agent-R10]: Operator의 문서 쓰기는 남길 문서 선언이 아니라 정의의 권한
// (제공된 tool)과 담당 자리, 그리고 tool 판정의 평소 규칙이 정한다. 실제 core(임시 LOPHN_HOME)에
// Operator assignment와 run을 만들고 판정(decide·admit)을 부른다. 문서 읽기(`document.get`)만 가짜이고
// 나머지 run·assignment·approval·ToolCall 기록은 실제 ledger다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import { routePath } from "../../packages/protocol/server/mod.ts";
import { documentGet } from "../../packages/protocol/projects/mod.ts";
import type { CoreCall } from "../../packages/core/lophn-agent/tool-judgment/mod.ts";
import {
  APPROVALS,
  binding,
  coreCall,
  count,
  inspect,
  kit,
  openOperator,
  openWorld,
  requested,
  RUN_A,
  type Seat,
  tool,
  type World,
} from "./testing/tool-judgment-world.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const OTHER_PROJECT = "prj_01arz3ndektsv4rrffq69g5faw";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OPERATOR = "asg_01arz3ndektsv4rrffq69g5fax";
const OPERATOR_RUN = "run_01arz3ndektsv4rrffq69g5fax";
const OPERATOR_MESSAGE = "msg_01arz3ndektsv4rrffq69g5fax";
const APP_OPERATOR = "asg_01arz3ndektsv4rrffq69g5fay";
const APP_OPERATOR_RUN = "run_01arz3ndektsv4rrffq69g5fay";
const APP_OPERATOR_MESSAGE = "msg_01arz3ndektsv4rrffq69g5fay";

const HERE = "doc_01arz3ndektsv4rrffq69g5fa1";
const ELSEWHERE = "doc_01arz3ndektsv4rrffq69g5fa2";
const IN_APP = "doc_01arz3ndektsv4rrffq69g5fa3";
const UNPLACED = "doc_01arz3ndektsv4rrffq69g5fa4";
const MISSING = "doc_01arz3ndektsv4rrffq69g5fa5";

type Place = { kind: "project" | "app"; id: string } | null;

// 문서마다 놓인 자리. 표에 없는 문서는 읽을 수 없는 문서(없는 문서와 같은 답)다.
const PLACES = new Map<string, Place>([
  [HERE, { kind: "project", id: PROJECT }],
  [ELSEWHERE, { kind: "project", id: OTHER_PROJECT }],
  [IN_APP, { kind: "app", id: APP }],
  [UNPLACED, null],
]);

const AT = "2026-10-04T00:00:00.000Z";
const HASH = "a".repeat(64);

function documentReply(document: string, place: Place) {
  return {
    document: {
      id: document,
      title: "Report",
      place,
      name: place === null ? null : "report",
      latest_version: "ver_01arz3ndektsv4rrffq69g5fav",
      revision: "7",
      status: "active",
    },
    version: {
      id: "ver_01arz3ndektsv4rrffq69g5fav",
      document,
      number: 1,
      files: [{
        path: "report.md",
        blob_hash: HASH,
        bytes: 12,
        media_type: "text/markdown",
        primary: true,
      }],
      content_hash: HASH,
      format: { name: "document", module_hash: HASH, explicit: true },
      saved_by: "user",
      saved_at: AT,
      run: null,
      source: null,
    },
    reference: {
      place: "mahas",
      document: "report",
      section: null,
      version: 1,
    },
    as_of_seq: "9",
    next_cursor: null,
  };
}

// 실제 agent 자격의 호출에 문서 읽기만 가짜로 얹는다. 읽은 문서 id를 모아 보여 준다.
function withDocuments(real: CoreCall, reads: string[]): CoreCall {
  return (path, body) => {
    if (path !== routePath(documentGet)) return real(path, body);
    const document = (body as { document: string }).document;
    reads.push(document);
    if (!PLACES.has(document)) {
      return Promise.resolve(
        err({ code: "not_found", message: "the document is not available" }),
      );
    }
    return Promise.resolve(ok(documentReply(document, PLACES.get(document)!)));
  };
}

// 문서 쓰기 tool. Operator 정의의 권한에 document.save_version이 있을 때 제공되는 tool이다. 소유
// 계약의 대상은 저장할 문서이고 새 version은 되돌릴 수 있다.
function save(
  document: string,
  reversibility: "reversible" | "unknown" = "reversible",
) {
  return {
    definition: tool("document.save_version", { reversible: true }),
    binding: binding([{ id: document, reversibility }], {
      concern: "documents/versions",
    }),
  };
}

type Decided = {
  decision: string;
  effect: string | null;
  approval: string | null;
  reads: string[];
  row: Record<string, unknown> | undefined;
};

async function writes(
  world: World,
  seat: Seat,
  document: string,
  options: { listed?: boolean; reversibility?: "reversible" | "unknown" } = {},
): Promise<Decided> {
  const entry = save(document, options.reversibility ?? "reversible");
  const reads: string[] = [];
  const { deps, judgment } = kit(
    world,
    seat,
    options.listed === false ? [] : [entry],
    { agent: withDocuments(coreCall(world.server, seat.token), reads) },
    [document],
  );
  assert(deps.assignment === seat.assignment.id);
  const request = await requested(world, seat.run, entry.definition, {
    note: "monthly report",
  });
  const decided = await judgment.decide(request);
  assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
  const admitted = await judgment.admit(
    { ...request, stateSeq: decided.value.stateSeq },
    decided.value.decision,
  );
  assert(admitted.ok, admitted.ok ? "" : JSON.stringify(admitted.error));
  return {
    decision: decided.value.decision.decision,
    effect: decided.value.decision.effect,
    approval: decided.value.decision.approval,
    reads,
    row: inspect(
      world.server,
      "select state, outcome from tool_calls where id = ?",
      [request.toolCall],
    )[0],
  };
}

async function openOperators(world: World) {
  const project = await openOperator(world, { kind: "project", id: PROJECT }, {
    assignment: OPERATOR,
    run: OPERATOR_RUN,
    message: OPERATOR_MESSAGE,
    token: "o".repeat(43),
  });
  const app = await openOperator(world, { kind: "app", id: APP }, {
    assignment: APP_OPERATOR,
    run: APP_OPERATOR_RUN,
    message: APP_OPERATOR_MESSAGE,
    token: "p".repeat(43),
  });
  return { project, app };
}

Deno.test("lophn-agent/roles/operator#R7 lophn-agent/harness/tool-judgment#R3 [agent-R10]: 권한에 tool이 있으면 Operator는 선언 없이 자기 자리 문서의 새 version을 묻지 않고 쓴다", async () => {
  const world = await openWorld();
  try {
    const { project, app } = await openOperators(world);
    // project Operator는 그 project 문서에, 앱 Operator는 그 앱 문서에 쓴다. 어떤 assignment도 이 문서를
    // 출력으로 선언하지 않았다.
    const here = await writes(world, project, HERE);
    assertEquals(here.decision, "allow");
    assertEquals(here.effect, "reversible_write");
    assertEquals(here.approval, null);
    assertEquals([...new Set(here.reads)], [HERE]);
    const inApp = await writes(world, app, IN_APP);
    assertEquals(inApp.decision, "allow");
    assertEquals(inApp.effect, "reversible_write");
    assertEquals(count(world.server, APPROVALS), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/operator#R7 lophn-agent/harness/tool-judgment#R2 [agent-R10]: 담당 자리 밖 문서·다른 종류의 자리·자리 없는 문서·읽을 수 없는 문서의 쓰기는 approval request 없이 deny다", async () => {
  const world = await openWorld();
  try {
    const { project, app } = await openOperators(world);
    const outside: [Seat, string][] = [
      [project, ELSEWHERE],
      [project, IN_APP],
      [project, UNPLACED],
      [project, MISSING],
      [app, HERE],
      [app, ELSEWHERE],
    ];
    for (const [seat, document] of outside) {
      const denied = await writes(world, seat, document);
      assertEquals(
        denied.decision,
        "deny",
        `${seat.assignment.id} ${document}`,
      );
      assertEquals(denied.approval, null);
      // 호출은 시작하지 않고 미실행으로 닫힌다.
      assertEquals(denied.row?.["state"], "finished");
      assertEquals(
        JSON.parse(String(denied.row?.["outcome"])).kind,
        "not_executed",
      );
    }
    assertEquals(count(world.server, APPROVALS), 0);
    // 같은 문서라도 자리가 맞는 Operator는 쓴다.
    assertEquals((await writes(world, project, HERE)).decision, "allow");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/operator#R7 lophn-agent/harness/tool-judgment#R3 [agent-R10]: 자리 안 문서라도 되돌림 보장이 없으면 평소처럼 묻는다", async () => {
  const world = await openWorld();
  try {
    const { project } = await openOperators(world);
    const unsure = await writes(world, project, HERE, {
      reversibility: "unknown",
    });
    assertEquals(unsure.decision, "ask");
    assertEquals(unsure.effect, "irreversible");
    assert(unsure.approval !== null);
    assertEquals(count(world.server, APPROVALS), 1);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/operator#R5 lophn-agent/harness/tool-judgment#R2 [agent-R10]: 정의의 권한에 없어 제공되지 않은 문서 쓰기 tool은 자리 안 문서여도 deny다", async () => {
  const world = await openWorld();
  try {
    const { project } = await openOperators(world);
    const missing = await writes(world, project, HERE, { listed: false });
    assertEquals(missing.decision, "deny");
    assertEquals(missing.approval, null);
    assertEquals(count(world.server, APPROVALS), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/roles/operator#R7 [agent-R10]: 자리 검사는 Operator에게만 걸리고 다른 역할의 문서 쓰기는 평소 판정 그대로다", async () => {
  const world = await openWorld();
  try {
    // lophn run은 자리 없는 문서도 평소 규칙(되돌릴 수 있는 쓰기는 allow)으로 판정한다.
    const entry = save(UNPLACED);
    const reads: string[] = [];
    const { judgment } = kit(
      world,
      "a",
      [entry],
      {
        agent: withDocuments(coreCall(world.server, world.runs.a.token), reads),
      },
      [UNPLACED],
    );
    const request = await requested(world, RUN_A, entry.definition, {
      note: "plan",
    });
    const decided = await judgment.decide(request);
    assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
    assertEquals(decided.value.decision.decision, "allow");
    assertEquals(reads, []);
  } finally {
    await world.dispose();
  }
});
