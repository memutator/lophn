// 거절 억제(platform/approvals#R16)를 실제 core와 임시 LOPHN_HOME에서 본다. run과 handoff 계보는
// lophn-agent의 실제 command(AcceptRun)로 만든다: 같은 사람 요청(message)에서 시작한 run, 그
// 요청에서 handoff로 이어진 다른 assignment의 run, 다른 사람 요청의 run. 계보 판정은 runs/read의
// source(message 또는 handoff의 original_message·sender_run)와 같은 값이다. handoff tool을 거친
// 끝에서 끝까지는 lophn-agent#T32가 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type {
  ApprovalAction,
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/protocol/server/mod.ts";
import { type Core, startCore } from "./core.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  type Reply,
  type Server,
} from "./testing/approvals-fixture.ts";
import { closeUnlessKept } from "./testing/close-on-throw.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const MACHINE_TOKEN = "b".repeat(43);
const USER_TOKEN = "e".repeat(43);
const MSG_ONE = id("msg", 1);
const MSG_TWO = id("msg", 2);
const RUN_A = id("run", 1);
const RUN_B = id("run", 2);
const RUN_C = id("run", 3);
const TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_TARGET = "doc_01h455vb4pex5v6nkc6gd5fdw2";
const REQUESTS = "select count(*) as n from approval_requests";

type Assignment = { id: string; role: string; revision: number };

type World = {
  core: Core;
  server: Server;
  home: string;
  lophn: Assignment;
  editor: Assignment;
  agents: Record<"a" | "b" | "c", { actor: string; token: string }>;
  dispose(): Promise<void>;
};

function context(
  actor: string,
  operations: string[],
  targets: Record<string, string> = {},
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets },
    conditions: targets,
    credential_ref: `cred-${actor}-${targets["run"] ?? "none"}`,
  } as AuthenticatedContext;
}

async function accept(
  core: Core,
  credential: AuthenticatedContext,
  token: string,
) {
  const accepted = await core.acceptTestCredential?.(credential, token);
  assert(accepted?.ok);
  const recorded = await core.record(credential);
  assert(recorded.ok);
}

async function post(
  world: Pick<World, "server">,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<Reply> {
  return await call(world.server, path, token, command(input, { compare }));
}

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-lineage-" });
  const clock = manualClock(Date.UTC(2024, 0, 1));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ lophnAgentDefinitions }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
    clock,
    random: seededRandom(41),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  });
  const core = started.value;
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  await accept(
    core,
    context("machine", ["ListAssignments", "AcceptRun"]),
    MACHINE_TOKEN,
  );
  await accept(
    core,
    context("user", [
      "reject_approval_request",
      "grant_approval_request",
      "GetApproval",
      "ListApprovals",
    ]),
    USER_TOKEN,
  );
  const listed = await call(server, "assignments/list", MACHINE_TOKEN, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignments = listed.body["assignments"] as Assignment[];
  // 기동이 lophn과 Context Engineer 전역 assignment를 준비한다. handoff는 assignment를 건넌다.
  const lophn = assignments.find((entry) => entry.role === "lophn");
  const editor = assignments.find((entry) => entry.role === "context_engineer");
  assert(lophn && editor);
  const world: World = {
    core,
    server,
    home,
    lophn,
    editor,
    agents: { a: tokenOf("a"), b: tokenOf("b"), c: tokenOf("c") },
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
    },
  };
  // 같은 사람 요청(MSG_ONE)에서 시작한 run A, 그 요청에서 handoff로 이어진 다른 assignment의 run B,
  // 다른 사람 요청(MSG_TWO)의 run C. 모두 실제 AcceptRun으로 접수한다.
  const a = await post(world, "runs/accept", MACHINE_TOKEN, {
    id: RUN_A,
    assignment: lophn.id,
    session: null,
    source: { kind: "message", message: MSG_ONE },
    continued_from: null,
    start_after: null,
  }, { assignment_revision: lophn.revision });
  assertEquals(a.status, 200, JSON.stringify(a.body));
  const b = await post(world, "runs/accept", MACHINE_TOKEN, {
    id: RUN_B,
    assignment: editor.id,
    session: null,
    source: {
      kind: "handoff",
      sender_run: RUN_A,
      original_message: MSG_ONE,
      body: "c".repeat(64),
      references: [],
      dedup_key: "handoff-one",
    },
    continued_from: null,
    start_after: null,
  }, { assignment_revision: editor.revision });
  assertEquals(b.status, 200, JSON.stringify(b.body));
  const c = await post(world, "runs/accept", MACHINE_TOKEN, {
    id: RUN_C,
    assignment: lophn.id,
    session: null,
    source: { kind: "message", message: MSG_TWO },
    continued_from: null,
    start_after: null,
  }, { assignment_revision: lophn.revision });
  assertEquals(c.status, 200, JSON.stringify(c.body));
  // 각 run에 묶인 agent 자격.
  for (
    const [key, assignment, run] of [
      ["a", lophn, RUN_A],
      ["b", editor, RUN_B],
      ["c", lophn, RUN_C],
    ] as const
  ) {
    const agent = world.agents[key];
    agent.actor = `agent:${assignment.id}`;
    await accept(
      core,
      context(agent.actor, ["create_approval_request"], {
        assignment: assignment.id,
        run,
      }),
      agent.token,
    );
  }
  guard.keep();
  return world;
}

function tokenOf(letter: string): { actor: string; token: string } {
  return { actor: "", token: `x${letter.repeat(42)}` };
}

function action(
  caller: string,
  targets: string[] = [TARGET],
  note = "first",
): Promise<ApprovalAction> {
  return actionOf({
    command: "record_owned_note",
    caller: caller as ApprovalAction["caller"],
    targets,
    value: { note },
    comparison: { basis: "current" },
  });
}

async function ask(
  world: World,
  who: "a" | "b" | "c",
  approval: string,
  run: string,
  fixed: ApprovalAction,
  reason: string,
): Promise<Reply> {
  const agent = world.agents[who];
  return await call(
    world.server,
    "approvals/create",
    agent.token,
    command(await createInput(approval, agent.actor, fixed, { run, reason })),
  );
}

Deno.test("platform/approvals#R16: 같은 run과 같은 사람 요청의 handoff 계보에서 거절된 같은 동작은 설명만 바꿔도 다시 묻지 않고 새 사람 요청은 막지 않는다", async () => {
  const world = await open();
  try {
    const a = world.agents.a.actor;
    const b = world.agents.b.actor;
    const first = await ask(
      world,
      "a",
      id("apr", 1),
      RUN_A,
      await action(a),
      "처음 묻는다",
    );
    assertEquals(first.status, 200, JSON.stringify(first.body));
    // 아직 거절되지 않았다면 억제하지 않는다: 같은 run이 같은 동작을 한 번 더 묻는 것은 막지 않는다.
    // (사람이 거절한 것만 억제한다.)
    const rejected = await decide(
      world.server,
      USER_TOKEN,
      first.body["request"] as ApprovalRequest,
      "reject",
    );
    assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
    assertEquals(count(world.server, REQUESTS), 1);

    // 같은 run이 설명만 바꿔 다시 묻는다: 억제한다. 새 request도 event도 없다.
    const sameRun = await ask(
      world,
      "a",
      id("apr", 2),
      RUN_A,
      await action(a),
      "설명을 바꿔 다시 묻는다",
    );
    assertEquals(sameRun.status, 409, JSON.stringify(sameRun.body));
    assertEquals(codeOf(sameRun), "conflict");
    assertEquals(
      (sameRun.body["error"] as { details?: { rejected_approval?: string } })
        .details?.rejected_approval,
      id("apr", 1),
    );

    // 같은 사람 요청에서 handoff로 이어진 다른 assignment의 run도 같은 동작을 다시 묻지 못한다.
    // 호출자(역할)는 달라도 같은 동작·대상·입력이다.
    const handedOff = await ask(
      world,
      "b",
      id("apr", 3),
      RUN_B,
      await action(b),
      "넘겨받은 일이라 묻는다",
    );
    assertEquals(handedOff.status, 409, JSON.stringify(handedOff.body));
    assertEquals(count(world.server, REQUESTS), 1);

    // 입력이나 대상이 다르면 같은 동작이 아니다.
    const otherInput = await ask(
      world,
      "b",
      id("apr", 4),
      RUN_B,
      await action(b, [TARGET], "other input"),
      "입력이 다르다",
    );
    assertEquals(otherInput.status, 200, JSON.stringify(otherInput.body));
    const otherTarget = await ask(
      world,
      "a",
      id("apr", 5),
      RUN_A,
      await action(a, [OTHER_TARGET]),
      "대상이 다르다",
    );
    assertEquals(otherTarget.status, 200, JSON.stringify(otherTarget.body));

    // 새로운 사람 요청(MSG_TWO)의 run은 같은 동작을 다시 물을 수 있다.
    const fresh = await ask(
      world,
      "c",
      id("apr", 6),
      RUN_C,
      await action(world.agents.c.actor),
      "새 요청이라 묻는다",
    );
    assertEquals(fresh.status, 200, JSON.stringify(fresh.body));
    assertEquals(count(world.server, REQUESTS), 4);
  } finally {
    await world.dispose();
  }
});
