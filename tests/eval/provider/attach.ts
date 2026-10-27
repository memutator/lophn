import {
  agentDefinitionRead,
  type AgentRef,
  builtinAgentChange,
  connectProvider,
  type ModelChoice,
  modelDefaultRead,
  operatorChange,
  providerDefinitions,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";
import { settle } from "../../support/core/human.ts";

// `real`인 참가자에게만 agent 층 model을 붙인다. 전역과 project 층은 비워 두므로 나머지 참가자의 turn은
// model이 없어 provider를 부르지 않고 끝난다.
export async function attachRealModels(
  core: Core,
  input: {
    key: string;
    model: string;
    options?: Record<string, string>;
    real: AgentRef[];
    endpoint?: string;
  },
): Promise<{ provider: string; model: ModelChoice }> {
  // 전역 기본이 남아 있으면 real이 아닌 참가자도 model을 받아 비용과 채점이 틀어진다.
  if ((await core.call(modelDefaultRead, {})).default !== null) {
    throw new Error("전역 기본 model이 비어 있지 않다");
  }
  const { definitions } = await core.call(providerDefinitions, {});
  const definition = definitions.find((item) => item.key === "anthropic");
  const protocol = definition?.protocols[0];
  const modelsEndpoint = definition?.models_endpoint;
  if (
    definition === undefined || protocol === undefined ||
    modelsEndpoint === null || modelsEndpoint === undefined ||
    !modelsEndpoint.endsWith("/models")
  ) {
    throw new Error("내장 anthropic provider 정의를 찾지 못했다");
  }
  const endpoint = input.endpoint ??
    modelsEndpoint.slice(0, -"/models".length);

  const id = core.ids.newId("pvd");
  const secret = `provider.${id.slice("pvd_".length)}`;
  const put = await core.upload(secret, new TextEncoder().encode(input.key));
  if (!put.ok) throw new Error(`secrets/put: ${put.error.code}`);
  await core.call(connectProvider, {
    id,
    name: "anthropic",
    definition,
    endpoint,
    protocol,
    auth_kind: "api_key",
    credential: { secret },
  });

  const model: ModelChoice = {
    provider: id,
    model_name: input.model,
    option_values: input.options ?? {},
  };
  for (const agent of input.real) {
    const read = await core.call(agentDefinitionRead, { agent });
    // 정의는 파일 전체의 새 내용이라 읽은 칸을 그대로 두고 model만 바꾼다.
    if (agent.role === "operator") {
      const current = read.definition;
      if (current === null || !("name" in current)) {
        throw new Error(`Operator 정의가 없다: ${agent.agent}`);
      }
      await core.call(
        operatorChange,
        {
          agent: agent.agent,
          definition: { ...current, model },
        },
        { hash: read.hash },
      );
    } else {
      const { skills, mcp_off, body } = read.definition ?? { body: "" };
      await core.call(
        builtinAgentChange,
        {
          agent,
          definition: {
            model,
            ...(skills === undefined ? {} : { skills }),
            ...(mcp_off === undefined ? {} : { mcp_off }),
            body,
          },
        },
        { hash: read.hash },
      );
    }
  }
  await settle(core);
  return { provider: id, model };
}
