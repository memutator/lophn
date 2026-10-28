import { ok, type Result } from "../../../base/mod.ts";
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
} from "../../../protocol/lophn-agent/mod.ts";
import { domainList, domainNameSchema } from "../../../protocol/domains/mod.ts";
import {
  commandOf,
  defineTool,
  fitted,
  invalid,
  notFound,
  readOf,
  type ToolContext,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";

const domainNames = domainNameSchema.array();

async function domainIdsOf(
  names: readonly string[],
  ctx: ToolContext,
): Promise<Result<string[]>> {
  const read = await readOf(ctx.core, domainList, { status: "active" });
  if (!read.ok) return read;
  const ids: string[] = [];
  for (const name of names) {
    const found = read.value.domains.find((domain) => domain.name === name);
    if (found === undefined) return invalid(`domain ${name} not found`);
    ids.push(found.id);
  }
  return ok(ids);
}

export const AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "agent.create",
    input: agentDefinitionSchema
      .omit({ mcp_servers: true, skip: true })
      .extend({ domains: domainNames.optional() })
      .strict(),
    routes: [domainList, agentCreate],
    description:
      "Create an agent. Give its name, profile, model, skills, domains (domain names), mcp_off and instructions (body). Its grants, MCP servers and skip default are set by the person.",
    effect: "write",
    handler: async (input, ctx) => {
      const { domains, ...rest } = input;
      const definition = { ...rest } as Omit<AgentDefinition, "domains"> & {
        domains?: string[];
      };
      if (domains !== undefined) {
        const ids = await domainIdsOf(domains, ctx);
        if (!ids.ok) return ids;
        definition.domains = ids.value;
      }
      const made = await commandOf(
        ctx.core,
        agentCreate,
        { id: ctx.ids.newId("agt"), definition },
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`created agent ${definition.name}`, made.value));
    },
  }),
  defineTool({
    name: "agent.update",
    defer: true,
    input: agentDefinitionSchema
      .omit({ name: true, mcp_servers: true, skip: true })
      .partial()
      .extend({ agent: agentNameSchema, domains: domainNames.optional() })
      .strict(),
    routes: [agentList, agentRead, domainList, agentChange],
    description:
      "Change an agent by name. Only the fields you send change. Its grants, MCP servers and skip default are set by the person.",
    effect: "write",
    handler: async (input, ctx) => {
      const { agent, domains, ...rest } = input;
      const listed = await readOf(ctx.core, agentList, {});
      if (!listed.ok) return listed;
      const key = agentNameKey(agent);
      const row = listed.value.agents.find(
        (entry) => agentNameKey(entry.name) === key,
      );
      if (row === undefined) return notFound("agent not found");
      const current = await readOf(ctx.core, agentRead, { agent: row.agent });
      if (!current.ok) return current;
      const { definition, hash, issues } = current.value;
      if (
        issues.length > 0 ||
        (definition === null && row.agent !== LOPHN_AGENT_ID)
      ) {
        return invalid("the agent file is broken");
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
      const changed = await commandOf(
        ctx.core,
        agentChange,
        { agent: row.agent, definition: { ...base, ...patch } },
        { hash },
        ctx.tool_call,
      );
      if (!changed.ok) return changed;
      return ok(fitted(`changed agent ${agent}`, changed.value));
    },
  }),
];
