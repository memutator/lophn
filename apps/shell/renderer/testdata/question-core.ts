// 질문이 있는 실제 core. 실제 core 테스트(real-core.ts의 startRealCore)와 headless shell
// 확인이 별도 프로세스로 띄운다. renderer bundle에는 들어가지 않는다.
//
// apps/core/main.ts처럼 core를 띄우되 test credential 입구를 열어, 사람이 연 세션의 run을
// machine이 시작하고 그 run의 agent가 글이 있는 질문을 만든다. coding agent는 세션 없는
// approval request를 하나 만든다. 모두 실제 HTTP route로 보낸다. 그런 뒤에야 core가 부모
// pipe에 쓴 hello frame을 stdout으로 넘기므로, 부모가 hello를 읽으면 질문이 이미 있다.
//
//   LOPHN_HOME=$(mktemp -d) deno run --allow-all apps/shell/renderer/testdata/question-core.ts
//   ... --seed-only  # 심고 바로 멈춘다(그 root로 shell을 headless로 띄울 때)
//
// LOPHN_HOME이 없으면 띄우지 않는다. 사람 데이터 root(~/.lophn)는 열지 않는다. 실제
// provider는 부르지 않는다(run은 machine이 시작만 하고 model을 부르지 않는다).
// renderer 설정(lib DOM)은 core·contracts graph를 type check하지 않으므로 계산한 경로로
// 불러 필요한 모양만 적는다.
import {
  SEED_APPROVAL,
  SEED_OPTIONS,
  SEED_PROMPT,
  SEED_QUESTION,
  SEED_REASON,
  SEED_RECOMMENDED,
  SEED_SESSION,
  SEED_WHY,
} from "./question-seed.ts";

interface Context {
  principal: string;
  actor: string;
  credential_ref: string;
  scope: { operations: string[]; targets: Record<string, unknown> };
  conditions: Record<string, unknown>;
}

interface Result<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { message?: string };
}

interface Core {
  port: number;
  done: Promise<void>;
  shutdown(): Promise<void>;
  record(context: Context): Promise<Result>;
  acceptTestCredential?(context: Context, token: string): Promise<Result>;
}

interface CoreModule {
  startCore(options: Record<string, unknown>): Promise<Result<Core>>;
}

type TeamModule = Record<string, unknown>;

interface ApprovalAction {
  concern: string;
  command: string;
  caller: string;
  targets: string[];
  input: { kind: "inline"; value: Record<string, unknown> };
  input_hash: string;
  comparison: Record<string, unknown>;
  binding_hash: string;
}

interface PlatformContracts {
  approvalBinding(action: ApprovalAction): unknown;
}

interface Base {
  fingerprint(value: unknown): Promise<string>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

const root = new URL("../../../../", import.meta.url);
const load = <T>(path: string) =>
  import(new URL(path, root).href) as Promise<T>;

const home = Deno.env.get("LOPHN_HOME");
if (home === undefined || home === "") {
  console.error("question-core: LOPHN_HOME이 없다. temp dir를 준다.");
  Deno.exit(2);
}
const seedOnly = Deno.args.includes("--seed-only");

const { startCore } = await load<CoreModule>("apps/core/core.ts");
// apps/core/main.ts의 TEAMS와 같은 팀 등록이다. 같아야 이 root로 제품 core(shell이 띄우는
// core)가 schema를 그대로 받아 시작한다. 다르면 제품 core가 시작을 거절하므로 바로 드러난다.
const TEAM_FILES = [
  "apps/core/documents.ts",
  "apps/core/apps.ts",
  "apps/core/problems.ts",
  "apps/core/coding-agent.ts",
  "apps/core/lophn-agent.ts",
  "apps/core/tickets.ts",
];
const [documents, apps, problems, codingAgent, lophnAgent, tickets] =
  await Promise.all(TEAM_FILES.map((path) => load<TeamModule>(path)));
const teams = [
  { createLedgerRegistration: documents!.createLedgerRegistration },
  { createLedgerRegistration: apps!.createLedgerRegistration },
  { problemsTestDefinitions: problems!.problemsTestDefinitions },
  { problemsReportDefinitions: problems!.problemsReportDefinitions },
  { createLedgerRegistration: problems!.createLedgerRegistration },
  {
    codingAgentConnectionDefinitions: codingAgent!
      .codingAgentConnectionDefinitions,
  },
  { lophnAgentDefinitions: lophnAgent!.lophnAgentDefinitions },
  { createLedgerRegistration: lophnAgent!.createLedgerRegistration },
  { ticketDefinitions: tickets!.ticketDefinitions },
];
const contracts = await load<PlatformContracts>(
  "packages/contracts/platform/mod.ts",
);
const base = await load<Base>("packages/base/mod.ts");

// 부모 pipe. core가 쓴 frame(hello)은 다 심을 때까지 모았다가 stdout으로 넘긴다.
const held: Uint8Array[] = [];
let forward: WritableStreamDefaultWriter<Uint8Array> | null = null;
const stdout = new WritableStream<Uint8Array>({
  async write(chunk) {
    if (forward === null) held.push(chunk.slice());
    else await forward.write(chunk);
  },
});
let closeStdin = () => {};
const stdin = seedOnly
  ? new ReadableStream<Uint8Array>({
    start(controller) {
      closeStdin = () => controller.close();
    },
  })
  : Deno.stdin.readable;

const started = await startCore({
  lophnHome: home,
  port: 0,
  writerClock: "system",
  teams,
  teamModules: TEAM_FILES.map((path) => new URL(path, root).href),
  parent: { stdin, stdout },
  testCredentials: true,
});
if (!started.ok || started.value === undefined) {
  console.error(`question-core: ${started.error?.message ?? "기동 실패"}`);
  Deno.exit(1);
}
const core = started.value;

const stop = async (code: number) => {
  await core.shutdown();
  Deno.exit(code);
};
Deno.addSignalListener("SIGTERM", () => void stop(0));
Deno.addSignalListener("SIGINT", () => void stop(0));

// hello frame(길이 4 + kind 1 + channel 4 + JSON)에서 사람 token을 꺼낸다.
async function userToken(): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const bytes = new Uint8Array(held.reduce((sum, b) => sum + b.length, 0));
    let offset = 0;
    for (const chunk of held) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (bytes.length >= 9) {
      const length = new DataView(bytes.buffer).getUint32(0, false);
      if (bytes.length >= 4 + length && bytes[4] === 1) {
        const hello = JSON.parse(
          new TextDecoder().decode(bytes.slice(9, 4 + length)),
        ) as { user_token?: string };
        if (typeof hello.user_token === "string") return hello.user_token;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("hello를 읽지 못했다");
}

async function post(path: string, body: unknown, token: string) {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const value = await response.json() as Record<string, unknown>;
  if (response.status !== 200) {
    throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  }
  return value;
}

function command(
  input: unknown,
  key: string,
  compare: unknown,
  run?: string,
) {
  return {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
    ...(run === undefined ? {} : { run }),
  };
}

let serial = 0;
async function grant(
  actor: string,
  operations: string[],
  bound: Record<string, string> = {},
): Promise<string> {
  serial += 1;
  const context: Context = {
    principal: actor.startsWith("agent:") ? actor : `seed-${serial}`,
    actor,
    credential_ref: `cred_seed_${serial}`,
    scope: { operations, targets: bound },
    conditions: bound,
  };
  const token = `seed${serial}`.padEnd(43, "t");
  const accepted = await core.acceptTestCredential!(context, token);
  if (!accepted.ok) throw new Error(`credential: ${accepted.error?.message}`);
  const recorded = await core.record(context);
  if (!recorded.ok) throw new Error(`record: ${recorded.error?.message}`);
  return token;
}

type Assignment = { id: string; role: string; revision: number; state: string };

async function seed(): Promise<void> {
  const user = await userToken();
  const listed = await post("assignments/list", {}, user) as {
    assignments: Assignment[];
  };
  const lophn = listed.assignments.find((item) => item.role === "lophn")!;
  const assignmentCompare = {
    assignment_revision: lophn.revision,
    assignment_state: lophn.state,
  };
  await post(
    "sessions/open",
    command(
      {
        id: SEED_SESSION,
        assignment: lophn.id,
        role: lophn.role,
        work_place: { kind: "global", id: null },
        continued_from: null,
      },
      "seed-open-session",
      assignmentCompare,
    ),
    user,
  );
  const session = await post(
    "sessions/read",
    { session: SEED_SESSION },
    user,
  ) as { session: { state_seq: string } };
  const sent = await post(
    "messages/receive",
    command(
      {
        id: "msg_01k6qs0000000000000000000a",
        session: SEED_SESSION,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "Tidy up the weekly notes." }],
        },
        mode: "request",
      },
      "seed-first-message",
      {
        session_state: "open",
        session_state_seq: session.session.state_seq,
        ...assignmentCompare,
      },
    ),
    user,
  ) as { message: { run: string } };
  const run = sent.message.run;

  // run은 machine이 시작만 한다. model은 부르지 않는다.
  const machine = await grant("machine", ["ReadRun", "StartRun"]);
  const read = await post("runs/read", { run }, machine) as {
    run: { state_seq: string };
  };
  await post(
    "runs/start",
    command(
      {
        run,
        basis: "b".repeat(64),
        limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
        scope: { role: "lophn", assignment: lophn.id, apps: [] },
      },
      "seed-start-run",
      { state_seq: read.run.state_seq },
    ),
    machine,
  );

  // 그 run의 agent가 글이 있는 질문을 낸다.
  const agent = await grant(`agent:${lophn.id}`, ["CreateQuestion"], {
    assignment: lophn.id,
    run,
  });
  await post(
    "questions/create",
    command(
      {
        id: SEED_QUESTION,
        run,
        session: SEED_SESSION,
        prompt: SEED_PROMPT,
        reason: SEED_REASON,
        options: SEED_OPTIONS.map((option) => ({
          ...option,
          evidence: [],
          adoption: null,
          action: null,
        })),
        recommendation: { option_key: SEED_RECOMMENDED, explanation: SEED_WHY },
        expires_at: null,
      },
      "seed-question",
      {},
      run,
    ),
    agent,
  );

  // coding agent의 세션 없는 approval request. notification 계기다.
  const coding = await grant(
    "coding_agent:cac_01k6qs0000000000000000000a",
    ["create_approval_request"],
  );
  const draft = {
    concern: "apps/invocations",
    command: "record_started",
    caller: "coding_agent:cac_01k6qs0000000000000000000a",
    targets: ["app_01k6qs0000000000000000000a"],
    input: {
      kind: "inline" as const,
      value: { release: "rel_01k6qs0000000000000000000a" },
    },
    input_hash: "ab".repeat(32),
    comparison: { release: "rel_01k6qs0000000000000000000a" },
  };
  const action: ApprovalAction = {
    ...draft,
    binding_hash: await base.fingerprint(
      contracts.approvalBinding({ ...draft, binding_hash: "ab".repeat(32) }),
    ),
  };
  await post(
    "approvals/create",
    command(
      {
        id: SEED_APPROVAL,
        requester: draft.caller,
        run: null,
        reason: "Start the release before review",
        effect: {
          changes: "Starts one release",
          external: null,
          reversible: false,
          reversibility: "A started release can't be undone",
        },
        action,
        expires_at: null,
      },
      "seed-approval",
      {},
    ),
    coding,
  );
}

try {
  await seed();
} catch (error) {
  console.error(`question-core: ${(error as Error).message}`);
  await stop(1);
}

if (seedOnly) {
  closeStdin();
  await stop(0);
}

forward = Deno.stdout.writable.getWriter();
for (const chunk of held.splice(0)) await forward.write(chunk);
await core.done;
Deno.exit(0);
