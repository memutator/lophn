import { ok, type Result } from "../../../../base/mod.ts";
import {
  agentDefinitionList,
  agentDefinitionRead,
  operatorChange,
  operatorCreate,
  type Place,
} from "../../../../protocol/lophn-agent/mod.ts";
import { appList } from "../../../../protocol/apps/mod.ts";
import { projectList } from "../../../../protocol/projects/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import { settingsEditIntent } from "../../tool-judgment/intents.ts";
import type { GateRequest, ToolDefinition } from "../registry.ts";
import type { ToolContext } from "../tool-context.ts";
import type { ToolInput } from "../domain/input.ts";
import { operatorPlaceAllowed } from "../domain/operator-place.ts";
import { fitted, forbidden, invalid, notFound } from "../domain/result.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 설정 고치기라 실행 전에 Gate에 묻는다. grant와 앱 Operator의 project 폴더는 입력에 없고 사람이 정한다.
function gateFor(id: string | null, ctx: ToolContext): GateRequest {
  const intent = settingsEditIntent({
    what: "agent_definition",
    id,
    session: ctx.session,
    turn: ctx.turn,
    toolCall: ctx.tool_call,
    agent: ctx.agent,
  });
  return {
    kind: intent.kind,
    target: intent.target,
    effect: intent.effect,
    input: intent.input,
  };
}

// 입력의 place는 project나 앱의 id 또는 이름이다.
async function resolvePlace(
  place: ToolInput<"operator.create">["place"],
  ctx: ToolContext,
): Promise<Result<Place>> {
  if ("project" in place) {
    const value = place.project;
    if (ctx.place?.kind === "project" && ctx.place.id === value) {
      return ok(ctx.place);
    }
    const read = await readOf(ctx.core, projectList, {});
    if (!read.ok) return read;
    const found = read.value.projects.find((project) =>
      project.id === value || project.name === value
    );
    return found === undefined
      ? notFound("project not found")
      : ok({ kind: "project", id: found.id });
  }
  const value = place.app;
  if (ctx.place?.kind === "app" && ctx.place.id === value) return ok(ctx.place);
  const read = await readOf(ctx.core, appList, {});
  if (!read.ok) return read;
  const found = read.value.apps.find((app) =>
    app.id === value || app.slug === value || app.name === value
  );
  return found === undefined
    ? notFound("app not found")
    : ok({ kind: "app", id: found.id });
}

export const OPERATOR_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "operator.create",
    input: TOOL_INPUTS["operator.create"],
    routes: [projectList, appList, operatorCreate],
    description:
      "Create an Operator in your own place (Project Manager: your project, App Engineer: your app). Give its name, profile, model, contexts, skills_off, mcp_off and instructions (body). Its grants are given by the person.",
    effect: "write",
    gate: (input, ctx) =>
      gateFor((input as ToolInput<"operator.create">).name, ctx),
    handler: async (input, ctx) => {
      const { place, ...definition } = input as ToolInput<"operator.create">;
      const target = await resolvePlace(place, ctx);
      if (!target.ok) return target;
      if (!operatorPlaceAllowed(ctx.role, ctx.place, target.value)) {
        return forbidden("an Operator of another place");
      }
      const made = await commandOf(
        ctx.core,
        operatorCreate,
        { id: ctx.ids.newId("agt"), place: target.value, definition },
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`created Operator ${definition.name}`, made.value));
    },
  }),
  defineTool({
    name: "operator.update",
    input: TOOL_INPUTS["operator.update"],
    routes: [agentDefinitionList, agentDefinitionRead, operatorChange],
    description:
      "Change an Operator of your own place by its name. Only the fields you send change.",
    effect: "write",
    gate: (input, ctx) =>
      gateFor((input as ToolInput<"operator.update">).operator, ctx),
    handler: async (input, ctx) => {
      const { operator, ...patch } = input as ToolInput<"operator.update">;
      if (ctx.place === null) return forbidden("an Operator of another place");
      const listed = await readOf(ctx.core, agentDefinitionList, {
        place: ctx.place,
      });
      if (!listed.ok) return listed;
      const row = listed.value.agents.find((entry) =>
        entry.kind === "operator" && entry.name === operator
      );
      if (row === undefined || row.place === null) {
        return notFound("Operator not found");
      }
      if (!operatorPlaceAllowed(ctx.role, ctx.place, row.place)) {
        return forbidden("an Operator of another place");
      }
      const current = await readOf(ctx.core, agentDefinitionRead, {
        agent: row.agent,
      });
      if (!current.ok) return current;
      const { definition, hash } = current.value;
      if (
        row.agent.role !== "operator" || definition === null || hash === null
      ) {
        return invalid("the Operator file is broken");
      }
      const changed = await commandOf(
        ctx.core,
        operatorChange,
        {
          agent: row.agent.agent,
          definition: { ...definition, ...patch },
        },
        { hash },
        ctx.tool_call,
      );
      if (!changed.ok) return changed;
      return ok(fitted(`changed Operator ${operator}`, changed.value));
    },
  }),
];
