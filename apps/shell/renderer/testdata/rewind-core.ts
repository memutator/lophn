// 한 번 되돌린 session이 있는 실제 core. 실제 core 테스트(real-core.ts의 startRealCore)가 별도 프로세스로 띄운다.
// renderer bundle에는 들어가지 않는다.
//
// apps/core/main.ts처럼 core를 띄우되 test credential 입구를 열어, 사람이 연 session에 메시지 둘을 보내 각각의 run을
// 멈춘 뒤(model은 부르지 않는다) 둘째 메시지로 "Restore messages only" Rewind를 실제 HTTP route로 적용한다. Rewind의
// 확인 handle은 보호 창이 발급하는 것이라 test credential 입구(core.confirmation)로 같은 binding에 발급한다. 그런 뒤에야
// core가 부모 pipe에 쓴 hello frame을 stdout으로 넘기므로, 부모가 hello를 읽으면 되돌린 session이 이미 있다.
//
// LOPHN_HOME이 없으면 띄우지 않는다. 사람 데이터 root(~/.lophn)는 열지 않는다.
import {
  REWIND_FIRST,
  REWIND_FIRST_TEXT,
  REWIND_PROJECT,
  REWIND_REVERT,
  REWIND_SECOND,
  REWIND_SECOND_TEXT,
  REWIND_SESSION,
} from "./rewind-seed.ts";

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
  confirmation?(body: {
    action: "issue";
    request: unknown;
  }): Promise<Result<{ confirmation: string }>>;
}

interface CoreModule {
  startCore(options: Record<string, unknown>): Promise<Result<Core>>;
}

type TeamModule = Record<string, unknown>;

const root = new URL("../../../../", import.meta.url);
const load = <T>(path: string) =>
  import(new URL(path, root).href) as Promise<T>;

const home = Deno.env.get("LOPHN_HOME");
if (home === undefined || home === "") {
  console.error("rewind-core: LOPHN_HOME이 없다. temp dir를 준다.");
  Deno.exit(2);
}

const { startCore } = await load<CoreModule>("apps/core/core.ts");
// apps/core/main.ts의 TEAMS와 같은 팀 등록이다.
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
const contracts = await load<{
  rewind: unknown;
}>("packages/contracts/lophn-agent/mod.ts");
const identity = await load<{
  confirmationBinding(
    route: unknown,
    input: unknown,
  ): Promise<{ target: string; content: string } | undefined>;
}>("packages/platform/identity/mod.ts");

// 부모 pipe. core가 쓴 frame(hello)은 다 심을 때까지 모았다가 stdout으로 넘긴다.
const held: Uint8Array[] = [];
let forward: WritableStreamDefaultWriter<Uint8Array> | null = null;
const stdout = new WritableStream<Uint8Array>({
  async write(chunk) {
    if (forward === null) held.push(chunk.slice());
    else await forward.write(chunk);
  },
});

const started = await startCore({
  lophnHome: home,
  port: 0,
  writerClock: "system",
  teams,
  teamModules: TEAM_FILES.map((path) => new URL(path, root).href),
  parent: { stdin: Deno.stdin.readable, stdout },
  testCredentials: true,
});
if (!started.ok || started.value === undefined) {
  console.error(`rewind-core: ${started.error?.message ?? "기동 실패"}`);
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
  extra: Record<string, unknown> = {},
) {
  return {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
    ...extra,
  };
}

type Assignment = { id: string; role: string; revision: number; state: string };
type SessionRead = { session: { state_seq: string } };

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
  // Rewind의 사전 검사는 project 폴더를 읽는다. 폴더 하나를 연결한다.
  const folder = await Deno.makeTempDir({ prefix: "lophn-rewind-seed-" });
  await post(
    "projects/create",
    command(
      {
        id: REWIND_PROJECT,
        name: "weekly",
        title: "Weekly",
        purpose: "",
        folders: [{ path: folder, description: "Notes" }],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      "seed-project",
      {},
    ),
    user,
  );
  await post(
    "sessions/open",
    command(
      {
        id: REWIND_SESSION,
        assignment: lophn.id,
        work_place: { kind: "project", id: REWIND_PROJECT },
        opening_context: null,
      },
      "seed-open-session",
      assignmentCompare,
    ),
    user,
  );

  // 메시지 하나를 보내고 그 run을 멈춘다(model을 부르지 않는다).
  async function say(message: string, text: string, key: string) {
    const session = await post(
      "sessions/read",
      { session: REWIND_SESSION },
      user,
    ) as SessionRead;
    const sent = await post(
      "messages/receive",
      command(
        {
          id: message,
          session: REWIND_SESSION,
          content: { schema_version: 1, parts: [{ kind: "text", text }] },
          mode: "request",
        },
        key,
        {
          session_state: "open",
          session_state_seq: session.session.state_seq,
          ...assignmentCompare,
        },
      ),
      user,
    ) as { message: { run: string } };
    const run = sent.message.run;
    const read = await post("runs/read", { run }, user) as {
      run: { state_seq: string };
    };
    await post(
      "runs/stop",
      command(
        { run, request_key: `stop-${run}`, reason: "user_stopped" },
        `stop-${run}`,
        { state_seq: read.run.state_seq },
      ),
      user,
    );
  }
  await say(REWIND_FIRST, REWIND_FIRST_TEXT, "seed-first");
  await say(REWIND_SECOND, REWIND_SECOND_TEXT, "seed-second");

  // 둘째 메시지로 "Restore messages only"를 적용한다. 확인 handle은 보호 창이 발급하는 것과 같은 binding으로 만든다.
  const choice = "messages_only";
  const shown = await post("rewind/preview", {
    kind: "rewind",
    session: REWIND_SESSION,
    checkpoint: REWIND_SECOND,
    choice,
  }, user) as { preview_hash: string };
  const input = {
    id: REWIND_REVERT,
    session: REWIND_SESSION,
    checkpoint: REWIND_SECOND,
    choice,
    accept_remaining: false,
    preview_hash: shown.preview_hash,
    summary_call: null,
    files: [],
  };
  const binding = await identity.confirmationBinding(contracts.rewind, input);
  if (binding === undefined) throw new Error("no confirmation binding");
  const issued = await core.confirmation!({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "seed-rewind-window",
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: ["Rewind"],
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  if (!issued.ok) throw new Error(`handle: ${issued.error?.message}`);
  await post(
    "rewind/apply",
    command(
      input,
      "seed-rewind",
      { session_state: "open", active_run: null, applying_revert: null },
      { confirmation: issued.value!.confirmation },
    ),
    user,
  );
}

try {
  await seed();
} catch (error) {
  console.error(`rewind-core: ${(error as Error).message}`);
  await stop(1);
}

forward = Deno.stdout.writable.getWriter();
for (const chunk of held.splice(0)) await forward.write(chunk);
await core.done;
Deno.exit(0);
