import { isAbsolute, relative, sep } from "node:path";
import { ok, type Result } from "../../../../base/mod.ts";
import { appGet } from "../../../../protocol/apps/mod.ts";
import type { Role } from "../../../../protocol/lophn-agent/places.ts";
import {
  contextGetRoute,
  projectApi,
} from "../../../../protocol/projects/mod.ts";
import { readOf } from "../../../lophn-agent/run-loop/core-call.ts";
import { notFound } from "../../../lophn-agent/tools/fit-result.ts";
import type { ToolContext } from "../../../lophn-agent/tools/tool-context.ts";

// agent가 읽을 수 있는 context를 정한다. 범위 밖은 없는 대상과 같은 not_found로 답한다.

// App Engineer는 자기 앱 source가 속한 project를 알아야 하므로 app place에 그 project를 싣는다.
export type VisiblePlace =
  | { kind: "project"; id: string }
  | { kind: "app"; id: string; project: string | null }
  | null;

export function contextVisible(
  role: Role,
  place: VisiblePlace,
  attached: readonly string[],
  target: { context: string; project: string },
): boolean {
  switch (role) {
    case "lophn":
      return true;
    case "project_manager":
      return place?.kind === "project" && place.id === target.project;
    case "app_engineer":
      return place?.kind === "app" && place.project === target.project;
    case "operator":
      return attached.includes(target.context);
  }
}

function inside(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// 앱 source가 든 project. 어느 project에도 없으면 null이다.
async function projectOfApp(
  app: string,
  ctx: ToolContext,
): Promise<Result<string | null>> {
  const found = await readOf(ctx.core, appGet, { app });
  if (!found.ok) return found;
  const source = found.value.app.source_path;
  if (source === null) return ok(null);
  const listed = await readOf(ctx.core, projectApi.list, {
    status: "active",
  });
  if (!listed.ok) return listed;
  const owner = listed.value.projects.find((project) =>
    project.folders.some((folder) => inside(folder.path, source))
  );
  return ok(owner?.id ?? null);
}

// 이 session의 읽기 범위. 읽기 tool이 route를 부르기 전에 쓴다.
type ContextAccess = {
  role: Role;
  place: VisiblePlace;
  attached: readonly string[];
};

export async function contextAccess(
  ctx: ToolContext,
): Promise<Result<ContextAccess>> {
  const { role } = ctx;
  const attached: readonly string[] = [];
  let place: VisiblePlace = null;
  if (ctx.place?.kind === "project") {
    place = { kind: "project", id: ctx.place.id };
  } else if (ctx.place?.kind === "app") {
    const project = role === "app_engineer"
      ? await projectOfApp(ctx.place.id, ctx)
      : ok(null);
    if (!project.ok) return project;
    place = { kind: "app", id: ctx.place.id, project: project.value };
  }
  return ok({ role, place, attached });
}

// context 하나를 읽어도 되는지 본다. project를 알아야 하는 role만 context를 읽는다.
export async function checkVisible(
  ctx: ToolContext,
  context: string,
): Promise<Result<ContextAccess>> {
  const access = await contextAccess(ctx);
  if (!access.ok) return access;
  const { role, place, attached } = access.value;
  if (role === "lophn") return access;
  if (role === "operator") {
    return attached.includes(context) ? access : notFound(MISSING);
  }
  const read = await readOf(ctx.core, contextGetRoute, { context });
  if (!read.ok) {
    return read.error.code === "not_found" ? notFound(MISSING) : read;
  }
  const project = read.value.context.project;
  return contextVisible(role, place, attached, { context, project })
    ? access
    : notFound(MISSING);
}

const MISSING = "no such context";
