// 사람이 화면에서 하는 일을 route 하나와 기다림으로 옮긴 helper다. flow의 단계는 test file에 쓴다.
import {
  type AgentRef,
  connectProvider,
  modelDefaultChange,
  openAgentSession,
  providerList,
  sendMessage,
  stopTurn as stopTurnRoute,
  turnList,
  turnRead,
  type TurnRecord,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import { turnRequestDecide } from "../../../packages/protocol/approvals/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import { projectApi } from "../../../packages/protocol/projects/mod.ts";
import { platformHealth } from "../../../packages/protocol/server/mod.ts";
import type { Core } from "./mod.ts";
import { runtimePids } from "./process.ts";

export type Turn = TurnRecord;

const WAIT_MS = 30_000;
const POLL_MS = 50;
const MODEL_NAME = "claude-sonnet-4-5";

// 신호를 읽는 조건이 맞을 때까지 되풀이한다. 맞으면 즉시 돌아오고 제한 시간이 지나면 무엇을 기다렸는지 담아 실패한다.
export async function until<T>(
  what: string,
  read: () => Promise<T | undefined>,
  timeoutMs = WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`${timeoutMs}ms 안에 ${what}이(가) 되지 않았다`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function hostOf(endpoint: string): string {
  return new URL(endpoint).host;
}

// provider나 project 폴더가 바뀌면 core가 1초 polling으로 agent runtime child를 새 권한으로 다시 띄우고, 그 사이
// 시작한 turn은 끊긴다. 옛 child의 pid(`since`)가 모두 사라지고 새 child가 ready가 될 때까지 기다린다.
// 인자 없이 부르면 지금 runtime이 ready인 것만 확인한다.
export async function settle(core: Core, since: number[] = []): Promise<void> {
  await until("agent runtime이 다시 뜸", async () => {
    const pids = await runtimePids(core.run.home);
    if (pids.length === 0 || pids.some((pid) => since.includes(pid))) return;
    const health = await core.call(platformHealth, {});
    const runtime = health.observations.find((item) =>
      item.component === "agent-runtime"
    );
    return runtime?.available ? true : undefined;
  });
}

// key 없는 provider는 custom 정의(auth none)로, key가 있으면 secret을 먼저 올리고 api_key로 연결한다.
export async function connectFakeProvider(
  core: Core,
  fake: { url: string },
  options: { key?: string } = {},
): Promise<{ provider: string }> {
  const before = await runtimePids(core.run.home);
  // 같은 host:port가 이미 있으면 목적지 목록이 안 바뀌어 runtime을 다시 띄우지 않는다.
  const known = (await core.call(providerList, {})).providers;
  const restarts = !known.some((item) =>
    hostOf(item.endpoint) === hostOf(fake.url)
  );
  const provider = core.ids.newId("pvd");
  const key = options.key;
  const secret = `provider.${provider.slice("pvd_".length)}`;
  if (key !== undefined) {
    const put = await core.upload(secret, new TextEncoder().encode(key));
    if (!put.ok) throw new Error(`secrets/put: ${put.error.code}`);
  }
  await core.call(connectProvider, {
    id: provider,
    name: "fake",
    definition: {
      key: "anthropic",
      display_name: "Fake Anthropic",
      protocols: ["anthropic-messages"],
      auth_kinds: [key === undefined ? "none" : "api_key"],
      models_endpoint: null,
      oauth: null,
      revision: "e2e",
    },
    endpoint: fake.url,
    protocol: "anthropic-messages",
    auth_kind: key === undefined ? "none" : "api_key",
    credential: key === undefined ? null : { secret },
  });
  await core.call(modelDefaultChange, {
    default: { provider, model_name: MODEL_NAME, option_values: {} },
  });
  if (restarts) await settle(core, before);
  return { provider };
}

function slug(folder: string): string {
  const last = folder.split("/").filter(Boolean).pop() ?? "project";
  const name = last.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return /^[a-z]/.test(name) ? name : `p-${name}`;
}

export async function openProject(
  core: Core,
  folder: string,
  name?: string,
): Promise<{ project: string }> {
  const before = await runtimePids(core.run.home);
  const project = core.ids.newId("prj");
  const title = name ?? slug(folder);
  await core.call(projectApi.register, {
    id: project,
    name: title,
    title,
    purpose: "",
    folders: [{ path: folder, description: "", subfolders: [] }],
  });
  await settle(core, before);
  return { project };
}

export async function openSession(
  core: Core,
  agent: AgentRef,
): Promise<string> {
  const id = core.ids.newId("ses");
  await core.call(openAgentSession, { id, agent, opening_context: null });
  return id;
}

export async function say(
  core: Core,
  session: string,
  text: string,
): Promise<{ message: string }> {
  const sent = await core.call(sendMessage, {
    id: core.ids.newId("msg"),
    session,
    content: { schema_version: 1, parts: [{ kind: "text", text }] },
    delivery: "next_turn",
    refs: [],
  });
  return { message: sent.message };
}

// 시작한 순서대로다.
export async function turnsOf(core: Core, session: string): Promise<Turn[]> {
  const { turns } = await core.call(turnList, { session });
  return [...turns].sort((a, b) =>
    a.started_at === b.started_at
      ? a.id.localeCompare(b.id)
      : a.started_at.localeCompare(b.started_at)
  );
}

// index번째(0부터, 시작한 순서) turn이 끝날 때까지 기다려 그 turn을 돌려준다.
export async function waitTurnEnd(
  core: Core,
  session: string,
  index = 0,
): Promise<Turn> {
  return await until(`turn ${index}이 끝남`, async () => {
    const turn = (await turnsOf(core, session))[index];
    return turn?.state === "finished" ? turn : undefined;
  });
}

export async function waitPermission(
  core: Core,
  session: string,
): Promise<{ request: string }> {
  return await until("권한 요청이 옴", async () => {
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    const request = snapshots[0]?.turn_requests[0];
    return request === undefined ? undefined : { request: request.id };
  });
}

// waitPermission의 짝이다. 사람 역할 helper 한도(열 개)는 흐름을 옮기는 helper를 세는 것이고, 이 helper는 같은 snapshot을 읽을 뿐이라 센 수에 넣지 않는다.
export async function waitQuestion(
  core: Core,
  session: string,
): Promise<{ turn: string; tool_call: string }> {
  return await until("질문이 옴", async () => {
    const { snapshots } = await core.call(sessionSnapshotsList, {
      sessions: [session],
    });
    const question = snapshots[0]?.questions[0];
    return question === undefined
      ? undefined
      : { turn: question.turn, tool_call: question.tool_call };
  });
}

export async function decide(
  core: Core,
  session: string,
  request: string,
  choice: "once" | "always" | "reject",
): Promise<void> {
  await core.call(turnRequestDecide, {
    session,
    request,
    choice: { kind: choice },
  });
}

export async function stopTurn(core: Core, turn: string): Promise<void> {
  const { turn: current } = await core.call(turnRead, { turn });
  await core.call(
    stopTurnRoute,
    { turn, request_key: core.ids.newId("key"), reason: "user_stopped" },
    { state_seq: current.state_seq },
  );
}
