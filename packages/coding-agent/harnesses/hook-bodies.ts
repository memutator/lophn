// harness가 직접 읽는 plugin·extension 파일의 원문이다. 전역에 놓으면 lophn과 상관없는 실행마다 불리므로 모두
// 터미널 hook env가 없으면 아무것도 등록하지 않는다. event는 `lophn hook <harness> <event>`의 stdin으로 넘긴다.
// 첫 줄의 `const COMMAND`는 dry_run이 놓인 command만 다른 파일을 같다고 보는 데 쓴다(`placedPluginCommand`).
import {
  HARNESS_ADAPTERS,
  type HarnessId,
  HOOK_EVENT_TABLE,
  TERMINAL_HOOK_ENV,
} from "../../protocol/coding-agent/mod.ts";

const COMMAND_LINE = /^const COMMAND = ("(?:[^"\\\n]|\\.)*");$/m;

export function placedPluginCommand(text: string | null): string | undefined {
  const found = text?.match(COMMAND_LINE)?.[1];
  return found === undefined ? undefined : JSON.parse(found) as string;
}

// harness 하나가 이 형식의 plugin 본문을 가지는지다.
export function pluginSource(
  harness: HarnessId,
  command: string,
): string | null {
  switch (harness) {
    case "pi":
      return piExtension(command);
    case "omp":
      return ompExtension(command);
    case "amp":
      return ampPlugin(command);
    case "opencode":
    case "kilo":
    case "mimocode":
      return opencodePlugin(harness, command);
    default:
      return null;
  }
}

// 모든 본문이 쓰는 process 실행이다. hook 실패가 harness를 멈추게 하지 않는다.
function spawnSend(harness: HarnessId): string {
  return `const COMMAND_ARGS = ["hook", ${JSON.stringify(harness)}];

function run(event, body) {
  try {
    const child = spawn(COMMAND, [...COMMAND_ARGS, event], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(body));
  } catch {
    // hook 실패가 harness를 멈추게 하지 않는다.
  }
}`;
}

// turn 끝에 싣는 마지막 답의 길이 상한이다. 답이 아무리 길어도 hook 호출이 부풀지 않게 plugin에서 자른다.
const MESSAGE_MAX_CHARS = 4000;

// 모든 본문이 쓰는 답 글 뽑기다. text block만 이어 붙이고, 비면 undefined다.
function answerSource(): string {
  return `const MESSAGE_MAX_CHARS = ${MESSAGE_MAX_CHARS};

function answerBlocks(blocks) {
  if (!Array.isArray(blocks)) return undefined;
  const text = blocks
    .filter((one) => one?.type === "text" && typeof one.text === "string" && !one.ignored && !one.synthetic)
    .map((one) => one.text)
    .join("\\n")
    .trim();
  return text === "" ? undefined : [...text].slice(0, MESSAGE_MAX_CHARS).join("");
}`;
}

// pi·omp·amp는 message의 모양이 같다(`role: "assistant"`, `content` block 배열).
const ROLE_ANSWER = `function answerOf(messages) {
  const last = Array.isArray(messages)
    ? [...messages].reverse().find((one) => one?.role === "assistant")
    : undefined;
  return answerBlocks(last?.content);
}`;

function head(harness: HarnessId, command: string): string {
  return `// lophn이 놓은 파일이다. ${
    HARNESS_ADAPTERS[harness].label
  } event를 \`lophn hook ${harness} <event>\`로 넘긴다.
import { spawn } from "node:child_process";

const COMMAND = ${JSON.stringify(command)};
${spawnSend(harness)}

${answerSource()}
`;
}

// pi extension이다. 듣는 event는 `HOOK_EVENT_TABLE.pi`다. 조사로 확인하지 못한 API가 있다(host가
// 아직 검증하지 않았다): `ctx.sessionManager.getSessionId()`, `agent_settled`의 `aborted`.
function piExtension(command: string): string {
  const events = Object.keys(HOOK_EVENT_TABLE.pi);
  return `${head("pi", command)}
${ROLE_ANSWER}

export default function (pi: any) {
  if (!process.env.${TERMINAL_HOOK_ENV}) return;
  // \`agent_settled\`에는 message가 없어 \`agent_end\`의 마지막 답을 기억했다가 싣는다. retry가 이어지면 마지막 \`agent_end\`의 것이 남는다.
  let answer: string | undefined;
  pi.on("agent_end", (event: any) => {
    answer = answerOf(event?.messages);
  });
${
    events.map((event) =>
      `  pi.on("${event}", (event: any, ctx: any) => {
    let session_id: string | undefined;
    try {
      session_id = ctx?.sessionManager?.getSessionId?.();
    } catch {
      // session id를 읽지 못하면 싣지 않는다.
    }
    run("${event}", {
      session_id,
      aborted: event?.aborted === true,
      reason: event?.reason,${
        event === "agent_settled" ? "\n      lophn_message: answer," : ""
      }
    });${event === "agent_settled" ? "\n    answer = undefined;" : ""}
  });`
    ).join("\n")
  }
}
`;
}

// omp extension이다. omp는 같은 extension을 subagent session마다 다시 묶으므로 main agent만 보고, agent 안에서 띄운
// omp(바깥 omp가 shell tool env에 `OMPCODE=1`을 둔다)는 등록하지 않는다. 한 turn의 끝은 `agent_end`가
// `willContinue`가 아닐 때뿐이고(이어질 때는 또 온다), 두 번 오는 것은 진행 중 flag로 막는다.
function ompExtension(command: string): string {
  return `${head("omp", command)}
${ROLE_ANSWER}

function sessionOf(ctx: any): string | undefined {
  try {
    return ctx?.sessionManager?.getSessionId?.();
  } catch {
    return undefined;
  }
}

// 마지막 assistant message의 stopReason이다.
function outcomeOf(messages: any): "completed" | "failed" | "interrupted" {
  const last = Array.isArray(messages)
    ? [...messages].reverse().find((one) => one?.role === "assistant")
    : undefined;
  if (last?.stopReason === "aborted") return "interrupted";
  return last?.stopReason === "error" ? "failed" : "completed";
}

export default function (omp: any) {
  if (!process.env.${TERMINAL_HOOK_ENV} || process.env.OMPCODE) return;
  let running = false;
  const main = (ctx: any) => ctx?.agent?.kind === "main";
  omp.on("session_start", (_event: any, ctx: any) => {
    if (main(ctx)) run("session_start", { session_id: sessionOf(ctx) });
  });
  omp.on("agent_start", (_event: any, ctx: any) => {
    if (!main(ctx)) return;
    running = true;
    run("agent_start", { session_id: sessionOf(ctx) });
  });
  omp.on("agent_end", (event: any, ctx: any) => {
    if (!main(ctx) || event?.willContinue === true || !running) return;
    running = false;
    run("agent_end", {
      session_id: sessionOf(ctx),
      outcome: outcomeOf(event?.messages),
      lophn_message: answerOf(event?.messages),
    });
  });
  omp.on("tool_approval_requested", (event: any, ctx: any) => {
    if (main(ctx)) {
      run("tool_approval_requested", {
        session_id: sessionOf(ctx),
        tool_name: event?.toolName,
        reason: event?.reason,
      });
    }
  });
  omp.on("tool_approval_resolved", (event: any, ctx: any) => {
    if (main(ctx)) {
      run("tool_approval_resolved", {
        session_id: sessionOf(ctx),
        tool_name: event?.toolName,
      });
    }
  });
}
`;
}

// Amp TS plugin이다. \`tool.call\`은 action을 돌려줘야 해서 듣지 않는다. 조사로 확인하지 못했다(host가 아직 검증하지
// 않았다): plugin이 \`PLUGINS=all\` 없이 켜지는지, \`agent.start\`·\`agent.end\` event의 \`thread.id\` 위치.
function ampPlugin(command: string): string {
  return `// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
${head("amp", command)}
${ROLE_ANSWER}

export default function (amp: any) {
  if (!process.env.${TERMINAL_HOOK_ENV}) return;
  amp.on("session.start", (event: any) => {
    run("session.start", { session_id: event?.thread?.id });
  });
  amp.on("agent.start", (event: any) => {
    run("agent.start", { session_id: event?.thread?.id });
  });
  amp.on("agent.end", (event: any) => {
    run("agent.end", {
      session_id: event?.thread?.id,
      status: event?.status,
      lophn_message: answerOf(event?.messages),
    });
  });
}
`;
}

// OpenCode 계열(opencode, kilo, mimocode) plugin이다. 셋은 같은 plugin API라 본문이 같고 harness 이름만 다르다. 듣는 event는
// 그 harness의 `HOOK_EVENT_TABLE`(1.x event 이름)이다.
//  - turn의 시작·끝(`session.status`)은 root session의 것만 넘긴다. 하위 session은 session 조회의 parentID로 가른다.
//    조회가 실패하면 root가 아닌 것으로 보고 넘기지 않는다(하위 session의 idle이 turn 끝으로 잘못 읽히는 쪽이 더 나쁘다).
//  - 권한·질문(\`permission.*\`, \`question.*\`)은 하위 session의 것도 root session의 것으로 바꿔 넘긴다. 사람이 답해야 하는 것은
//    root의 turn을 막는다.
//  - completed idle에는 \`properties.lophn_message\`로 session의 마지막 assistant 답(text part만, 길이 상한)도 싣는다. 못 읽으면
//    빼고 보낸다. turn 끝은 막히면 안 된다.
//  - idle에는 \`properties.lophn_outcome\`을 싣는다. \`session.error\`(MessageAbortedError는 interrupted, 나머지는
//    failed)나 2.x \`session.execution.failed·interrupted\` 뒤의 idle이 아니면 completed다.
// 2.x는 default export의 \`{id, setup}\`만 읽고 event를 \`ctx.event.subscribe\`로 직접 받는다(이름이 다르고 payload는
// \`{type, data}\`다). 1.x는 default의 \`server\`나 named export 함수를 읽으며 둘이 같은 함수여야 두 번 불리지 않는다.
// 2.x event를 1.x 이름과 모양으로 바꾸는 곳은 이 plugin 한 곳이다.
function opencodePlugin(harness: HarnessId, command: string): string {
  const events = Object.keys(HOOK_EVENT_TABLE[harness]);
  return `${head(harness, command)}
const EVENTS = new Set(${JSON.stringify(events)});
// session id → root session id. 조회가 실패하면 null이다.
const roots = new Map();
// root session id → session.error가 정한 outcome. 다음 idle이 쓰고 지운다.
const failures = new Map();

// SDK 세대마다 get의 인자 모양이 달라 둘 다 시도한다.
async function sessionOf1(client, id) {
  for (const args of [{ path: { id } }, { sessionID: id }]) {
    try {
      const session = (await client.session.get(args))?.data;
      if (session?.id === id) return session;
    } catch {
      // 다른 SDK 모양을 시도한다.
    }
  }
  return null;
}

async function sessionOf2(ctx, id) {
  try {
    return await ctx.session.get({ sessionID: id });
  } catch {
    return null;
  }
}

// 마지막 assistant message의 답 글이다. 1.x는 \`{info: {role}, parts}\`, 2.x는 \`{type: "assistant", content}\`다.
function answerOf1(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (const one of [...messages].reverse()) {
    if (one?.info?.role === "assistant") return answerBlocks(one.parts);
    if (one?.type === "assistant") return answerBlocks(one.content);
  }
  return undefined;
}

// 1.x SDK는 session.messages를 \`{path: {id}}\`나 \`{sessionID}\`로 받아 \`{data}\`로 돌려준다. 오래된 turn을 읽지 않게 끝에서 일부만 가져온다.
async function messageOf1(client, id) {
  for (const args of [{ path: { id }, query: { limit: 20 } }, { sessionID: id, limit: 20 }]) {
    try {
      const messages = (await client.session.messages(args))?.data;
      if (Array.isArray(messages)) return answerOf1(messages);
    } catch {
      // 다른 SDK 모양을 시도한다.
    }
  }
  return undefined;
}

// 2.x는 compaction 뒤의 message를 시간순으로 돌려주고 마지막은 turn 끝을 뜻하는 idle message다.
async function messageOf2(ctx, id) {
  try {
    return answerOf1(await ctx.session.context({ sessionID: id }));
  } catch {
    return undefined;
  }
}

async function rootOf(getSession, id) {
  if (!roots.has(id)) {
    let current = id;
    for (let depth = 0; depth < 8 && current !== null; depth++) {
      const session = await getSession(current);
      if (session?.id !== current) current = null;
      else if (!session.parentID) break;
      else current = session.parentID;
    }
    roots.set(id, current);
  }
  return roots.get(id);
}

async function forward(getSession, getMessage, type, properties) {
  try {
    if (type !== "session.error" && !EVENTS.has(type)) return;
    const id = properties?.sessionID;
    if (typeof id !== "string") return;
    const root = await rootOf(getSession, id);
    if (root === null) return;
    if (type === "permission.asked" || type === "permission.replied" || type.startsWith("question.")) {
      run(type, { type, properties: { ...properties, sessionID: root } });
      return;
    }
    if (root !== id) return;
    if (type === "session.error") {
      failures.set(id, properties.error?.name === "MessageAbortedError" ? "interrupted" : "failed");
      return;
    }
    if (type !== "session.status") return;
    if (properties.status?.type === "idle") {
      const lophn_outcome = properties.lophn_outcome ?? failures.get(id) ?? "completed";
      failures.delete(id);
      const lophn_message = lophn_outcome === "completed" ? await getMessage(id) : undefined;
      run(type, { type, properties: { ...properties, lophn_outcome, lophn_message } });
    } else {
      failures.delete(id);
      run(type, { type, properties });
    }
  } catch {
    // hook 실패가 harness를 멈추게 하지 않는다.
  }
}

// 2.x event(\`{type, data}\`)를 1.x 이름과 properties로 바꾼다. 듣지 않는 event는 null이다.
function eventOf1({ type, data }) {
  switch (type) {
    case "session.execution.started":
      return ["session.status", { ...data, status: { type: "busy" } }];
    case "session.execution.succeeded":
      return ["session.status", { ...data, status: { type: "idle" }, lophn_outcome: "completed" }];
    case "session.execution.failed":
      return ["session.status", { ...data, status: { type: "idle" }, lophn_outcome: "failed" }];
    case "session.execution.interrupted":
      return ["session.status", { ...data, status: { type: "idle" }, lophn_outcome: "interrupted" }];
    case "permission.asked":
      return [type, { ...data, permission: data.action }];
    case "permission.replied":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
      return [type, data];
    default:
      return null;
  }
}

export const LophnStatus = async ({ client }) => {
  if (!process.env.${TERMINAL_HOOK_ENV}) return {};
  return {
    event: async ({ event }) => {
      await forward((id) => sessionOf1(client, id), (id) => messageOf1(client, id), event?.type, event?.properties);
    },
  };
};

async function setup(ctx) {
  if (!process.env.${TERMINAL_HOOK_ENV}) return;
  const controller = new AbortController();
  (async () => {
    for await (const input of ctx.event.subscribe({ signal: controller.signal })) {
      const mapped = eventOf1(input);
      if (mapped) await forward((id) => sessionOf2(ctx, id), (id) => messageOf2(ctx, id), mapped[0], mapped[1]);
    }
  })().catch(() => {});
  return () => controller.abort();
}

export default { id: "lophn-status", server: LophnStatus, setup };
`;
}
