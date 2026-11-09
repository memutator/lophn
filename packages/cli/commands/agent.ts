// `lophn agent card|create|update`: agent 명함을 읽고, 정의를 만들고 고친다. agent는 handle(주소)로 가리킨다. 할당(권한)은 주지 못한다: 사람이 정한다.
// `mcp_servers`·`skip`·`apps`·`extensions`·`permissions`을 받지 않는 것은 입력 schema의 몫이고, core route도 agent 자격이면 거절한다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  type AgentDefinition,
  agentCard,
  agentChange,
  agentCreate,
  agentDefinitionSchema,
  agentList,
  agentHandleKey,
  agentHandleSchema,
  agentNameSchema,
  agentRead,
  isLophn,
  LOPHN_AGENT_HANDLE,
  LOPHN_AGENT_NAME,
} from "../../protocol/lophn-agent/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const card = defineCommand({
  name: "agent.card",
  summary: "Read an agent's card",
  description:
    "Read an agent's card by handle: handle, name, description, runtime, modality (what it takes and gives), replies it supports, how it differs from the default lophn agent (plus, minus) and notes. Read it before you call an agent. The handle `lophn` is the lophn of the workspace you run in.",
  input: z.strictObject({ handle: agentHandleSchema }),
  positional: ["handle"],
  effect: "read",
  routes: [agentCard],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(agentCard, { handle: input.handle });
    if (!read.ok) return read;
    const { callable } = read.value.card;
    return ok({
      summary: `card of ${read.value.card.handle}${
        callable === undefined
          ? ""
          : `\ncallable at home (no workspace): ${callable.home ? "yes" : "no"}\ncallable in this workspace: ${callable.here ? "yes" : "no"}`
      }`,
      content: read.value.card,
    });
  },
});

const create = defineCommand({
  name: "agent.create",
  summary: "Create an agent",
  description:
    "Create an agent. Give its handle (the address others use as `to.agent`; lowercase letters, digits, - and _, up to 40; unique, cannot change later; `lophn`, `claude`, `codex` and `opencode` are reserved), name (the display name; defaults to the handle), description (one line), runtime (`lophn` by default; `bare` loads only the instructions body and the tools and skills you pick, `claude-code`, `codex` or `opencode` run that CLI headless when the harness extension is on), tools (names to pick; bare only), skills (names to pick; bare only; picking one also gives skill.read), modality (input/output of text, image, file; all three by default), profile, model, skills_off, mcp_off and instructions (body). It is scoped to the workspace you run in (global when you run at home). Its assignments are given by the person. A favorite coding agent needs no definition: it is already callable by the handle `claude`, `codex` or `opencode`.",
  input: agentDefinitionSchema
    .omit({
      workspace: true,
      mcp_servers: true,
      skip: true,
      apps: true,
      extensions: true,
      permissions: true,
    })
    .extend({ name: agentNameSchema.optional() })
    .strict(),
  positional: ["handle"],
  effect: "write",
  routes: [agentCreate],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const made = await ctx.core.command(
      agentCreate,
      { definition: { ...input, name: input.name ?? input.handle } },
      {
        key: ctx.key,
      },
    );
    if (!made.ok) return made;
    return ok({
      summary: `created agent ${input.handle}`,
      content: made.value,
    });
  },
});

const update = defineCommand({
  name: "agent.update",
  summary: "Change an agent",
  description:
    "Change an agent by handle (`lophn` is the lophn of the workspace you run in). Only the fields you send change (its handle and workspace never change; name is the display name). Its assignments are given by the person.",
  input: agentDefinitionSchema
    .omit({
      handle: true,
      workspace: true,
      mcp_servers: true,
      skip: true,
      apps: true,
      extensions: true,
      permissions: true,
    })
    .partial()
    .extend({ agent: agentHandleSchema })
    .strict(),
  positional: ["agent"],
  effect: "write",
  routes: [agentList, agentRead, agentChange],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const { agent, ...rest } = input;
    const listed = await ctx.core.read(agentList, {});
    if (!listed.ok) return listed;
    const key = agentHandleKey(agent);
    const row = listed.value.agents.find(
      (entry) => agentHandleKey(entry.handle) === key,
    );
    if (row === undefined) {
      return err({ code: "not_found", message: "agent not found" });
    }
    const current = await ctx.core.read(agentRead, { agent: row.agent });
    if (!current.ok) return current;
    const { definition, hash, issues } = current.value;
    if (issues.length > 0 || (definition === null && !isLophn(row.agent))) {
      return err({
        code: "invalid_input",
        message: "the agent file is broken",
      });
    }
    const base: AgentDefinition = definition ?? {
      handle: LOPHN_AGENT_HANDLE,
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
