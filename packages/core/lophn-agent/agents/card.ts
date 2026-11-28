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
  isHarnessRuntime,
  MODALITIES,
  type Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
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

// 부르는 agent session의 자리와 call 정책. 명함의 callable을 정한다.
export type CardCaller = { from: AgentAtWorkspace; policy: CallPolicy };

// 부를 때 쓰는 agent id다. handle `lophn`은 부르는 workspace의 lophn으로 풀리므로 lophn 명함은 그 workspace의 id로 묻는다.
function agentAt(loaded: Loaded, workspace: Workspace | null) {
  return isLophn(loaded.agent) ? lophnIdOf(workspace) : loaded.agent;
}

// 명함의 차이는 그 agent의 정의로 계산한다(lophn이면 그 workspace의 lophn 정의). prompt 원문은 싣지 않는다.
// 차이는 그 agent 층에 배포받은 앱 skill(`deployed_skills`)로 계산한다: 전역·workspace 층의 배포는 그 agent의 차이가 아니다.
// `withoutApps`(slug)의 앱은 없는 것처럼 계산한다: 그 앱의 command와 skill, 그 앱 skill의 끄기가 차이에 남지 않는다.
function cardOf(
  context: AgentContext,
  loaded: Loaded,
  caller: CardCaller | null,
  withoutApps: readonly string[] = [],
): AgentCard {
  const definition = loaded.definition;
  const runtime = definition?.runtime ?? "lophn";
  const input = definition?.modality?.input ?? [...MODALITIES];
  const output = definition?.modality?.output ?? [...MODALITIES];
  const deployed = (definition?.deployed_skills ?? []).filter(
    (one) => !withoutApps.includes(one.app),
  );
  const hiddenSkills = new Set(
    context.lookups
      .shared(
        (definition?.deployed_skills ?? []).filter((one) =>
          withoutApps.includes(one.app),
        ),
      )
      .map((skill) => skill.name),
  );
  const off = (definition?.skills_off ?? []).filter(
    (name) => !hiddenSkills.has(name),
  );

  const diff =
    runtime === "custom"
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
              .sharedCommands(deployed)
              .map((command) => `command: ${command.slug} ${command.name}`),
            ...context.lookups
              .shared(deployed)
              .filter((skill) => !off.includes(skill.name))
              .map((skill) => `skill: ${skill.name}`),
            ...(definition?.mcp_servers ?? []).map(
              (server) => `mcp: ${server.name}`,
            ),
          ],
          minus: off.map((name) => `skill: ${name}`),
        };

  const notes: string[] = [];
  // harness runtime은 자기 model을 써서 lophn의 model 층이 그 agent의 model이 아니다.
  const chosen = isHarnessRuntime(runtime)
    ? null
    : effectiveModel(context, loaded, workspaceOfAgent(loaded));
  const info = chosen === null ? null : context.lookups.modelInfo(chosen.value);
  if (info?.inputMedia != null && input.includes("image")) {
    if (!info.inputMedia.includes("image")) {
      notes.push("The model cannot take images.");
    }
  }

  // harness runtime이 정의에 model을 고정했으면 명함에 보여 같은 harness의 설정만 다른 agent를 구분하게 한다. 가격은 알 수 없다.
  const harnessConfig = definition?.harness_config;
  const harnessModel =
    isHarnessRuntime(runtime) && harnessConfig?.model !== undefined
      ? {
          provider: runtime,
          model_name: harnessConfig.model,
          price: null,
          ...(harnessConfig.options === undefined ||
          Object.keys(harnessConfig.options).length === 0
            ? {}
            : { options: harnessConfig.options }),
        }
      : undefined;

  return {
    handle: handleOf(loaded),
    name: nameOf(loaded),
    workspace: workspaceOfAgent(loaded),
    ...(definition?.description === undefined
      ? {}
      : { description: definition.description }),
    runtime,
    ...(harnessModel !== undefined
      ? { model: harnessModel }
      : chosen === null || info === null
        ? {}
        : {
            model: {
              provider: info.provider,
              model_name: chosen.value.model_name,
              price: info.price,
            },
          }),
    modality: { input, output },
    // custom도 `lophn` tool로 `call.reply`를 늘 가져 모든 runtime이 셋 다 받는다.
    replies: ["none", "result", "conversation"],
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

// 그 workspace에서 보이는 agent들의 명함이다(전역과 그 workspace의 범위 agent, lophn은 그 workspace의 것). 틀린 정의 file은 뺀다.
export function cardsIn(
  context: AgentContext,
  workspace: Workspace | null,
  withoutApps: readonly string[] = [],
): Result<AgentCard[]> {
  const listed = listAgents(context);
  if (!listed.ok) return listed;
  return ok(
    listed.value
      .filter(
        (entry) => visibleIn(entry, workspace) && entry.issues.length === 0,
      )
      .map((entry) => cardOf(context, entry, null, withoutApps)),
  );
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
  const seen = listed.value.filter(
    (entry) => at === null || visibleIn(entry, at.workspace),
  );
  const loaded = seen.find((entry) => agentHandleKey(handleOf(entry)) === key);
  if (loaded === undefined) {
    return err({
      code: "not_found",
      message: `unknown agent handle "${handle}"; agents you can call: ${seen.map(handleOf).join(", ")}`,
    });
  }
  if (loaded.issues.length > 0) {
    return err({ code: "invalid_input", message: "the agent file is broken" });
  }
  return ok(cardOf(context, loaded, caller));
}
