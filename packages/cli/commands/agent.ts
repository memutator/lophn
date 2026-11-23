// `lophn agent list|card|create|update`: 부를 수 있는 agent 목록과 명함을 읽고(`--on`이면 다른 컴퓨터의 것), 정의를 만들고 고친다. agent는 handle(주소)로 가리킨다. 할당(권한)은 주지 못한다: 사람이 정한다.
// `mcp_servers`·`skip`·`apps`·`extensions`·`permissions`을 받지 않는 것은 입력 schema의 몫이고, core route도 agent 자격이면 거절한다.
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { machinesAgents } from "../../protocol/lophn-agent/a2a.ts";
import {
  type AgentCard,
  type AgentDefinition,
  agentCard,
  agentCards,
  agentChange,
  agentCreate,
  agentDefinitionSchema,
  agentHandleKey,
  agentHandleSchema,
  agentList,
  agentNameSchema,
  agentRead,
  isLophn,
  LOPHN_AGENT_HANDLE,
  LOPHN_AGENT_NAME,
} from "../../protocol/lophn-agent/mod.ts";
import {
  WORKSPACE_KINDS,
  type Workspace,
  workspaceNameSchema,
} from "../../protocol/lophn-agent/workspaces.ts";
import { agentModels } from "./agent-models.ts";
import { type CommandContext, defineCommand } from "./types.ts";

// 이 컴퓨터의 workspace는 id로 가리킨다(`agents/cards`가 id를 받는다). 이름은 다른 컴퓨터(`--on`)에서만 푼다.
function localWorkspace(
  name: z.infer<typeof workspaceNameSchema> | undefined,
  own: Workspace | null | undefined,
): Result<Workspace | null> {
  if (name === undefined) return ok(own ?? null);
  if ("home" in name) return ok(null);
  if ("project" in name && name.project.startsWith("prj_")) {
    return ok({ kind: "project", id: name.project as Id<"prj"> });
  }
  if ("app" in name && name.app.startsWith("app_")) {
    return ok({ kind: "app", id: name.app as Id<"app"> });
  }
  return err({
    code: "invalid_input",
    message:
      'on this computer name the workspace by its id ({"project":"prj_..."} or {"app":"app_..."}, as session list shows) or {"home":true}',
  });
}

// 다른 컴퓨터의 한 workspace에서 부를 수 있는 agent들. 그 workspace가 없거나 다른 컴퓨터에 닫혀 있으면 not_found다.
async function remoteCards(
  ctx: CommandContext,
  on: string,
  workspace: z.infer<typeof workspaceNameSchema> | undefined,
): Promise<Result<z.output<typeof machinesAgents.output>>> {
  const read = await ctx.core.read(machinesAgents, {
    machine: on,
    ...(workspace === undefined ? {} : { workspace }),
  });
  if (!read.ok) return read;
  if (!read.value.found) {
    return err({
      code: "not_found",
      message: `${read.value.machine.name} has no such workspace open to other computers`,
    });
  }
  return ok(read.value);
}

const workspaceField = workspaceNameSchema.optional();
const onField = z.string().min(1).optional();

const list = defineCommand({
  name: "agent.list",
  summary: "List the agents you can call",
  description:
    "List the agents you can call: handle, name, description, runtime, modality, replies. Without --workspace it is the agents of the workspace you run in. " +
    'On this computer --workspace is {"project":"prj_..."}, {"app":"app_..."} or {"home":true}. ' +
    '--on <computer> lists the agents on another computer of the person (machine computers); there --workspace is {"project":"<pri_ id>"}, {"app":"<slug>"} or {"home":true}. A project name works only when that project is also on this computer; otherwise use its cross-computer id (pri_…) from lophn project identity on that computer or from agent list --on.',
  input: z.strictObject({ workspace: workspaceField, on: onField }),
  effect: "read",
  routes: [agentCards, machinesAgents],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    let cards: AgentCard[];
    let where: Record<string, unknown> = {};
    if (input.on !== undefined) {
      const read = await remoteCards(ctx, input.on, input.workspace);
      if (!read.ok) return read;
      cards = read.value.cards;
      where = { machine: read.value.machine, workspace: read.value.workspace };
    } else {
      const workspace = localWorkspace(input.workspace, ctx.workspace);
      if (!workspace.ok) return workspace;
      const read = await ctx.core.read(agentCards, {
        workspace: workspace.value,
      });
      if (!read.ok) return read;
      cards = read.value.cards;
    }
    const agents = cards.map((card) => ({
      handle: card.handle,
      name: card.name,
      ...(card.description === undefined
        ? {}
        : { description: card.description }),
      runtime: card.runtime,
      modality: card.modality,
      replies: card.replies,
    }));
    return ok({
      summary: `${agents.length} agents can be called`,
      content: { ...where, agents },
      arrayKeys: ["agents"],
    });
  },
});

const card = defineCommand({
  name: "agent.card",
  summary: "Read an agent's card",
  description:
    "Read an agent's card by handle: handle, name, description, runtime, model with its price (USD per 1M tokens; absent for harness runtimes), modality (what it takes and gives), replies it supports, how it differs from the default lophn agent (plus, minus) and notes. Read it before you call an agent. The handle `lophn` is the lophn of the workspace you run in. " +
    "--on <computer> reads the card on another computer of the person, in --workspace there (as in agent list --on; without it the workspace you run in).",
  input: z.strictObject({
    handle: agentHandleSchema,
    workspace: workspaceField,
    on: onField,
  }),
  positional: ["handle"],
  effect: "read",
  routes: [agentCard, machinesAgents],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if (input.on !== undefined) {
      const read = await remoteCards(ctx, input.on, input.workspace);
      if (!read.ok) return read;
      const key = agentHandleKey(input.handle);
      const found = read.value.cards.find(
        (one) => agentHandleKey(one.handle) === key,
      );
      if (found === undefined) {
        return err({
          code: "not_found",
          message: `unknown agent handle "${input.handle}" on ${read.value.machine.name}; run agent list --on ${input.on} to see the agents there`,
        });
      }
      return ok({
        summary: `card of ${found.handle} on ${read.value.machine.name}`,
        content: found,
      });
    }
    if (input.workspace !== undefined) {
      return err({
        code: "invalid_input",
        message:
          "--workspace goes with --on; on this computer agent card reads the agents of the workspace you run in",
      });
    }
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
    "Create an agent. Give its handle (the address others use as `to.agent`; lowercase letters, digits, - and _, up to 40; unique, cannot change later; `lophn`, `claude`, `codex`, `opencode`, `omp` and `antigravity` are reserved), name (the display name; defaults to the handle), description (one line), runtime (`lophn` by default; `custom` loads only the instructions body and the tools and skills you pick, `claude-code`, `codex`, `opencode`, `omp` or `antigravity` run that coding agent CLI through its structured adapter), tools (names to pick; custom only), skills (names to pick; custom only; picking one also gives skill.read), modality (input/output of text, image, file; all three by default), avatar, model (lophn/custom only), harness_config (harness runtimes only), skills_off, mcp_off and instructions (body). It is scoped to the workspace you run in (global when you run at home). Read agent.models before choosing a model and its option_values. Its assignments are given by the person. A favorite coding agent needs no definition: it is already callable by its handle (`claude`, `codex`, `opencode`, `omp` or `antigravity`).",
  input: agentDefinitionSchema
    .omit({
      workspace: true,
      mcp_servers: true,
      skip: true,
      apps: true,
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
    "Change an agent by handle (`lophn` is the lophn of the workspace you run in). Only the fields you send change (its handle and workspace never change; name is the display name). Read agent.models before choosing model.provider, model.model_name and model.option_values. Its assignments are given by the person.",
  input: agentDefinitionSchema
    .omit({
      handle: true,
      workspace: true,
      mcp_servers: true,
      skip: true,
      apps: true,
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

export const AGENT_COMMANDS = [list, card, create, update, agentModels];
