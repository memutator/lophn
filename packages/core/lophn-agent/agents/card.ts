import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentCard,
  agentNameKey,
  MODALITIES,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileDefinition } from "./definition-file.ts";
import {
  type AgentContext,
  effectiveModel,
  listAgents,
  type Loaded,
  nameOf,
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

// 명함의 차이는 place와 상관없다(place = null). prompt 원문은 싣지 않는다.
function cardOf(context: AgentContext, loaded: Loaded): AgentCard {
  const definition = loaded.definition;
  const runtime = definition?.runtime ?? "lophn";
  const input = definition?.modality?.input ?? [...MODALITIES];
  const output = definition?.modality?.output ?? [...MODALITIES];
  const apps = definition?.apps ?? [];
  const off = definition?.skills_off ?? [];

  const diff =
    runtime === "bare"
      ? {
          plus: definition?.tools ?? [],
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
          ],
          minus: off.map((name) => `skill: ${name}`),
        };

  const notes: string[] = [];
  const model = effectiveModel(context, loaded, null);
  if (model !== null && input.includes("image")) {
    const media = context.lookups.inputMedia(model.value);
    if (media !== null && !media.includes("image")) {
      notes.push("The model cannot take images.");
    }
  }

  return {
    name: nameOf(loaded),
    ...(definition?.description === undefined
      ? {}
      : { description: definition.description }),
    runtime,
    modality: { input, output },
    replies: repliesOf({ runtime, tools: definition?.tools }),
    diff,
    notes,
  };
}

// 이름(앞뒤 공백과 대소문자 무시)으로 찾는 동기 조회다. 틀린 정의 file은 명함을 만들 수 없다.
export function cardByName(
  context: AgentContext,
  name: string,
): Result<AgentCard> {
  const listed = listAgents(context);
  if (!listed.ok) return listed;
  const key = agentNameKey(name);
  const loaded = listed.value.find(
    (entry) => agentNameKey(nameOf(entry)) === key,
  );
  if (loaded === undefined) {
    return err({ code: "not_found", message: "agent not found" });
  }
  if (loaded.issues.length > 0) {
    return err({ code: "invalid_input", message: "the agent file is broken" });
  }
  return ok(cardOf(context, loaded));
}
