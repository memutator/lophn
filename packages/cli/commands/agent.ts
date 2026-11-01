// `lophn agent create|update`: agent 정의를 만들고 고친다. 할당(권한)은 주지 못한다: 사람이 정한다.
// `mcp_servers`·`skip`을 받지 않는 것은 입력 schema의 몫이고, core route도 agent 자격이면 거절한다.
import { err, ok, type Result } from "../../base/mod.ts";
import { domainList, domainNameSchema } from "../../protocol/domains/mod.ts";
import {
  type AgentDefinition,
  agentChange,
  agentCreate,
  agentDefinitionSchema,
  agentList,
  agentNameKey,
  agentNameSchema,
  agentRead,
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../protocol/lophn-agent/mod.ts";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { type CommandContext, defineCommand } from "./types.ts";

const domainNames = domainNameSchema.array();

// 정의 파일에는 domain id가 들어간다. 이름은 core가 보여 주는 active domain에서 찾는다.
async function domainIdsOf(
  names: readonly string[],
  ctx: CommandContext,
): Promise<Result<string[]>> {
  const read = await ctx.core.read(domainList, { status: "active" });
  if (!read.ok) return read;
  const ids: string[] = [];
  for (const name of names) {
    const found = read.value.domains.find((domain) => domain.name === name);
    if (found === undefined) {
      return err({
        code: "invalid_input",
        message: `domain ${name} not found`,
      });
    }
    ids.push(found.id);
  }
  return ok(ids);
}

const create = defineCommand({
  name: "agent.create",
  summary: "Create an agent",
  description:
    "Create an agent. Give its name (unique; `lophn` is reserved), profile, model, skills, domains (none means all domains of the project or app it works in), mcp_off and instructions (body). Its assignments are given by the person.",
  input: agentDefinitionSchema
    .omit({ mcp_servers: true, skip: true })
    .extend({ domains: domainNames.optional() })
    .strict(),
  positional: ["name"],
  effect: "write",
  routes: [domainList, agentCreate],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const { domains, ...rest } = input;
    const definition = { ...rest } as Omit<AgentDefinition, "domains"> & {
      domains?: string[];
    };
    if (domains !== undefined) {
      const ids = await domainIdsOf(domains, ctx);
      if (!ids.ok) return ids;
      definition.domains = ids.value;
    }
    const made = await ctx.core.command(
      agentCreate,
      { definition },
      {
        key: ctx.key,
      },
    );
    if (!made.ok) return made;
    return ok({
      summary: `created agent ${definition.name}`,
      content: made.value,
    });
  },
});

const update = defineCommand({
  name: "agent.update",
  summary: "Change an agent",
  description:
    "Change an agent by name. Only the fields you send change. Its assignments are given by the person.",
  input: agentDefinitionSchema
    .omit({ name: true, mcp_servers: true, skip: true })
    .partial()
    .extend({ agent: agentNameSchema, domains: domainNames.optional() })
    .strict(),
  positional: ["agent"],
  effect: "write",
  routes: [agentList, agentRead, domainList, agentChange],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const { agent, domains, ...rest } = input;
    const listed = await ctx.core.read(agentList, {});
    if (!listed.ok) return listed;
    const key = agentNameKey(agent);
    const row = listed.value.agents.find(
      (entry) => agentNameKey(entry.name) === key,
    );
    if (row === undefined) {
      return err({ code: "not_found", message: "agent not found" });
    }
    const current = await ctx.core.read(agentRead, { agent: row.agent });
    if (!current.ok) return current;
    const { definition, hash, issues } = current.value;
    if (
      issues.length > 0 ||
      (definition === null && row.agent !== LOPHN_AGENT_ID)
    ) {
      return err({
        code: "invalid_input",
        message: "the agent file is broken",
      });
    }
    const base: AgentDefinition = definition ?? {
      name: LOPHN_AGENT_NAME,
      body: "",
    };
    const patch = { ...rest } as Partial<AgentDefinition> & {
      domains?: string[];
    };
    if (domains !== undefined) {
      const ids = await domainIdsOf(domains, ctx);
      if (!ids.ok) return ids;
      patch.domains = ids.value;
    }
    const changed = await ctx.core.command(
      agentChange,
      { agent: row.agent, definition: { ...base, ...patch } },
      { key: ctx.key, compare: { hash } },
    );
    if (!changed.ok) return changed;
    return ok({
      summary: `changed agent ${agent}`,
      content: changed.value,
    });
  },
});

export const AGENT_COMMANDS = [create, update];
