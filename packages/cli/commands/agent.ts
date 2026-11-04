// `lophn agent card|create|update`: agent 명함을 읽고, 정의를 만들고 고친다. 할당(권한)은 주지 못한다: 사람이 정한다.
// `mcp_servers`·`skip`·`apps`·`permissions`을 받지 않는 것은 입력 schema의 몫이고, core route도 agent 자격이면 거절한다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  type AgentDefinition,
  agentCard,
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
import { defineCommand } from "./types.ts";

const card = defineCommand({
  name: "agent.card",
  summary: "Read an agent's card",
  description:
    "Read an agent's card by name: description, runtime, modality (what it takes and gives), replies it supports, how it differs from the default lophn agent (plus, minus) and notes. Read it before you call an agent.",
  input: z.strictObject({ name: agentNameSchema }),
  positional: ["name"],
  effect: "read",
  routes: [agentCard],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(agentCard, { name: input.name });
    if (!read.ok) return read;
    return ok({
      summary: `card of ${read.value.card.name}`,
      content: read.value.card,
    });
  },
});

const create = defineCommand({
  name: "agent.create",
  summary: "Create an agent",
  description:
    "Create an agent. Give its name (unique; `lophn` is reserved), description (one line), runtime (`lophn` by default; `bare` loads only the instructions body and the `tools` you pick, and does not use skills), tools (names to pick; bare only), modality (input/output of text, image, file; all three by default), profile, model, skills_off, mcp_off and instructions (body). Its assignments are given by the person.",
  input: agentDefinitionSchema
    .omit({
      mcp_servers: true,
      skip: true,
      apps: true,
      permissions: true,
    })
    .strict(),
  positional: ["name"],
  effect: "write",
  routes: [agentCreate],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const made = await ctx.core.command(
      agentCreate,
      { definition: input },
      {
        key: ctx.key,
      },
    );
    if (!made.ok) return made;
    return ok({
      summary: `created agent ${input.name}`,
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
    .omit({
      name: true,
      mcp_servers: true,
      skip: true,
      apps: true,
      permissions: true,
    })
    .partial()
    .extend({ agent: agentNameSchema })
    .strict(),
  positional: ["agent"],
  effect: "write",
  routes: [agentList, agentRead, agentChange],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const { agent, ...rest } = input;
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
    const changed = await ctx.core.command(
      agentChange,
      { agent: row.agent, definition: { ...base, ...rest } },
      { key: ctx.key, compare: { hash } },
    );
    if (!changed.ok) return changed;
    return ok({
      summary: `changed agent ${agent}`,
      content: changed.value,
    });
  },
});

export const AGENT_COMMANDS = [card, create, update];
