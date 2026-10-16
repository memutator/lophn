import {
  agentDefinitionList,
  type CallAgent,
  type CallToInput,
  type NamedAgent,
  type Place,
} from "../../../../protocol/lophn-agent/mod.ts";
import { appList } from "../../../../protocol/apps/mod.ts";
import { projectList } from "../../../../protocol/projects/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolContext } from "../tool-context.ts";

// Gate에 물을 받는 agent를 푼다. 정확히 맞는 이름만 풀고 못 풀면 null이다. null이면 묻지 않고 보내며,
// Router가 같은 이름을 풀어 not_found로 닫거나 grant로 다시 판정한다(묻는 grant는 거기서 닫힌다).

async function operatorOf(
  ctx: ToolContext,
  name: string,
  place: Place | null,
): Promise<CallAgent | null> {
  const listed = await readOf(
    ctx.core,
    agentDefinitionList,
    place === null ? {} : { place },
  );
  if (!listed.ok) return null;
  const matches = listed.value.agents.filter((row) =>
    row.kind === "operator" && row.name === name
  );
  const only = matches.length === 1 ? matches[0]!.agent : null;
  return only === null || only.role !== "operator" ? null : only;
}

async function placeOf(
  ctx: ToolContext,
  place: NonNullable<NamedAgent["place"]>,
): Promise<Place | null> {
  if ("project" in place) {
    const read = await readOf(ctx.core, projectList, {});
    const found = read.ok
      ? read.value.projects.find((project) => project.name === place.project)
      : undefined;
    return found === undefined ? null : { kind: "project", id: found.id };
  }
  const read = await readOf(ctx.core, appList, {});
  const found = read.ok
    ? read.value.apps.find((app) => app.name === place.app)
    : undefined;
  return found === undefined ? null : { kind: "app", id: found.id };
}

async function named(
  ctx: ToolContext,
  to: NamedAgent,
): Promise<CallAgent | null> {
  if (to.role === "lophn") return { role: "lophn" };
  const place = to.place === undefined ? null : await placeOf(ctx, to.place);
  if (to.place !== undefined && place === null) return null;
  switch (to.role) {
    case "project_manager":
      return place?.kind === "project"
        ? { role: "project_manager", project: place.id }
        : null;
    case "app_engineer":
      return place?.kind === "app"
        ? { role: "app_engineer", app: place.id }
        : null;
    case "coding_agent":
      return place?.kind === "app"
        ? { role: "coding_agent", app: place.id }
        : null;
    case "operator":
      return to.name === undefined
        ? null
        : await operatorOf(ctx, to.name, place);
  }
}

// 열린 session의 agent는 session 목록에서 찾는다.
async function openSession(
  ctx: ToolContext,
  session: string,
): Promise<CallAgent | null> {
  const listed = await ctx.router.sendable();
  if (!listed.ok) return null;
  const row = listed.value.sessions.find((one) => one.session === session);
  if (row === undefined) return null;
  const place = row.place;
  switch (row.role) {
    case "lophn":
      return { role: "lophn" };
    case "project_manager":
      return place?.kind === "project"
        ? { role: "project_manager", project: place.id }
        : null;
    case "app_engineer":
    case "coding_agent":
      return place?.kind === "app" ? { role: row.role, app: place.id } : null;
    case "operator":
      return await operatorOf(ctx, row.name, place);
  }
}

export function callAgentOf(
  to: CallToInput,
  ctx: ToolContext,
): Promise<CallAgent | null> {
  return "role" in to ? named(ctx, to) : openSession(ctx, to.session);
}
