import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type CallPolicy,
  mayCall,
} from "../../../protocol/lophn-agent/call-policy.ts";
import {
  type AgentAtWorkspace,
  type AgentCard,
  agentHandleKey,
  isLophn,
  lophnIdOf,
  MODALITIES,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import {
  type AgentContext,
  effectiveModel,
  listAgents,
  handleOf,
  type Loaded,
  nameOf,
  visibleIn,
  workspaceOfAgent,
} from "./inspect.ts";

// lophn은 셋 다 받는다. bare는 `call.reply`를 골랐을 때만 대화를 이어 간다(답을 보낼 길이 그것뿐이라서다).
export function repliesOf(
  agent: Pick<AgentFileDefinition, "runtime" | "tools">,
): AgentCard["replies"] {
  if (agent.runtime !== "bare") return ["none", "result", "conversation"];
  return agent.tools?.includes("call.reply") === true
    ? ["none", "result", "conversation"]
    : ["none", "result"];
}

// 부르는 agent session의 자리와 call 정책. 명함의 callable을 정한다.
export type CardCaller = { from: AgentAtWorkspace; policy: CallPolicy };

// 부를 때 쓰는 agent id다. handle `lophn`은 부르는 workspace의 lophn으로 풀리므로 lophn 명함은 그 workspace의 id로 묻는다.
function agentAt(loaded: Loaded, workspace: Workspace | null) {
  return isLophn(loaded.agent) ? lophnIdOf(workspace) : loaded.agent;
}

// 명함의 차이는 그 agent의 정의로 계산한다(lophn이면 그 workspace의 lophn 정의). prompt 원문은 싣지 않는다.
function cardOf(
  context: AgentContext,
  loaded: Loaded,
  caller: CardCaller | null,
): AgentCard {
  const definition = loaded.definition;
  const runtime = definition?.runtime ?? "lophn";
  const input = definition?.modality?.input ?? [...MODALITIES];
  const output = definition?.modality?.output ?? [...MODALITIES];
  const apps = definition?.apps ?? [];
  const off = definition?.skills_off ?? [];

  const diff =
    runtime === "bare"
      ? {
          plus: [
            ...(definition?.tools ?? []),
            ...(definition?.skills ?? []).map((name) => `skill: ${name}`),
          ],
          minus: ["lophn built-ins"],
        }
      : {
          plus: [
            ...context.lookups
              .sharedCommands(apps, definition?.permissions?.deny ?? [])
              .map((command) => `command: ${command.slug} ${command.name}`),
            ...context.lookups
              .shared(apps)
              .filter((skill) => !off.includes(skill.name))
              .map((skill) => `skill: ${skill.name}`),
            ...(definition?.mcp_servers ?? []).map(
              (server) => `mcp: ${server.name}`,
            ),
            // 할당한 id 그대로다: 켜졌는지는 main thread의 메모리 catalog에만 있어 이 동기 읽기가 보지 못한다.
            ...(definition?.extensions ?? []).map((id) => `ext: ${id}`),
          ],
          minus: off.map((name) => `skill: ${name}`),
        };

  const notes: string[] = [];
  const model = effectiveModel(context, loaded, workspaceOfAgent(loaded));
  if (model !== null && input.includes("image")) {
    const media = context.lookups.inputMedia(model.value);
    if (media !== null && !media.includes("image")) {
      notes.push("The model cannot take images.");
    }
  }

  return {
    handle: handleOf(loaded),
    name: nameOf(loaded),
    workspace: workspaceOfAgent(loaded),
    ...(definition?.description === undefined
      ? {}
      : { description: definition.description }),
    runtime,
    modality: { input, output },
    replies: repliesOf({ runtime, tools: definition?.tools }),
    diff,
    notes,
    ...(caller === null
      ? {}
      : {
          callable: {
            home: mayCall(caller.policy, caller.from, {
              agent: agentAt(loaded, null),
              workspace: null,
            }),
            here: mayCall(caller.policy, caller.from, {
              agent: agentAt(loaded, caller.from.workspace),
              workspace: caller.from.workspace,
            }),
          },
        }),
  };
}

// handle(앞뒤 공백과 대소문자 무시)로 찾는 동기 조회다. 틀린 정의 file은 명함을 만들 수 없다.
// `at`이 있으면 그 workspace에서 보이는 agent만 찾는다(범위 agent와 lophn은 밖에서 not_found). 없으면 좁히지 않는다.
export function cardByHandle(
  context: AgentContext,
  handle: string,
  at: { workspace: Workspace | null } | null,
  caller: CardCaller | null,
): Result<AgentCard> {
  const listed = listAgents(context);
  if (!listed.ok) return listed;
  const key = agentHandleKey(handle);
  const loaded = listed.value.find(
    (entry) =>
      agentHandleKey(handleOf(entry)) === key &&
      (at === null || visibleIn(entry, at.workspace)),
  );
  if (loaded === undefined) {
    return err({ code: "not_found", message: "agent not found" });
  }
  if (loaded.issues.length > 0) {
    return err({ code: "invalid_input", message: "the agent file is broken" });
  }
  return ok(cardOf(context, loaded, caller));
}
