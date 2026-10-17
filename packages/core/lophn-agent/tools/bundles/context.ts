import { ok, type Result } from "../../../../base/mod.ts";
import { appGet } from "../../../../protocol/apps/mod.ts";
import { agentDefinitionRead } from "../../../../protocol/lophn-agent/mod.ts";
import {
  bundleOpenDraftRoute,
  bundleSubmitRoute,
  bundleTestDraftRoute,
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  contextSearchRoute,
  contextViolationsRoute,
  glossaryListRoute,
  glossaryRemoveRoute,
  glossarySetRoute,
  projectApi,
} from "../../../../protocol/projects/mod.ts";
import { contextGetOutputSchema } from "../../../../protocol/lophn-agent/context-text.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import { readContext } from "../../run-loop/place-data.ts";
import { renderContextText } from "../../prompt-assembly/mod.ts";
import { openDraft, setGlossary } from "../context/draft.ts";
import { searchContext } from "../context/search.ts";
import { checkVisible, contextAccess } from "../context/visible.ts";
import type { ToolInput } from "../domain/input.ts";
import { countSummary, fitted, notFound, readBody } from "../domain/result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolContext } from "../tool-context.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

type Row = {
  context: string;
  name: string;
  purpose: string;
  status: string;
  project: string;
};

const oneLine = (text: string) => text.split("\n")[0]!.trim();

// 보이는 context의 줄. lophn과 Project Manager와 App Engineer는 project 단위로, Operator는 붙은 것을 하나씩 읽는다.
async function visibleRows(
  ctx: ToolContext,
): Promise<Result<{ rows: Row[]; more: boolean }>> {
  const access = await contextAccess(ctx);
  if (!access.ok) return access;
  const { role, place, attached } = access.value;
  const projects: string[] = [];
  if (role === "lophn") {
    const listed = await readOf(ctx.core, projectApi.list, {
      status: "active",
    });
    if (!listed.ok) return listed;
    projects.push(...listed.value.projects.map((p) => p.id));
  } else if (place?.kind === "project" && role === "project_manager") {
    projects.push(place.id);
  } else if (place?.kind === "app" && role === "app_engineer") {
    if (place.project !== null) projects.push(place.project);
  }

  const rows: Row[] = [];
  let more = false;
  for (const project of projects) {
    const read = await readOf(ctx.core, contextListRoute, { project });
    if (!read.ok) return read;
    more ||= read.value.next_cursor !== null;
    for (const c of read.value.contexts) {
      rows.push({
        context: c.id,
        name: c.title,
        purpose: oneLine(c.purpose),
        status: c.status,
        project: c.project,
      });
    }
  }
  if (role === "operator") {
    for (const id of attached) {
      const read = await readOf(ctx.core, contextGetRoute, { context: id });
      if (!read.ok) continue;
      const c = read.value.context;
      rows.push({
        context: c.id,
        name: c.title,
        purpose: oneLine(c.purpose),
        status: c.status,
        project: c.project,
      });
    }
  }
  return ok({ rows, more });
}

// 읽기 tool이 route를 부르기 전에 읽기 범위를 알아내려고 부르는 route다(context/visible.ts).
const CONTEXT_ACCESS_ROUTES = [
  agentDefinitionRead,
  appGet,
  projectApi.list,
  contextGetRoute,
];

// context 읽기와 쓰기. 쓰기 셋(draft, submit, glossary.set)은 `builtinToolNames`가 Project Manager에게만 준다.
export const CONTEXT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "context.list",
    input: TOOL_INPUTS["context.list"],
    routes: [...CONTEXT_ACCESS_ROUTES, contextListRoute],
    description:
      "List the contexts you can read: id, name, one line purpose, status (drafting, active) and project.",
    effect: "read",
    handler: async (_input, ctx) => {
      const listed = await visibleRows(ctx);
      if (!listed.ok) return listed;
      const { rows, more } = listed.value;
      return ok(fitted(
        countSummary("contexts", rows.length, more),
        { contexts: rows },
        ["contexts"],
      ));
    },
  }),
  defineTool({
    name: "context.get",
    input: TOOL_INPUTS["context.get"],
    routes: [
      ...CONTEXT_ACCESS_ROUTES,
      contextContractRoute,
      glossaryListRoute,
      projectApi.get,
    ],
    description:
      "Read a context as the program describes it: purpose, project folders, types with fields and relations, searches with inputs, and the glossary. Also gives the applied version number.",
    effect: "read",
    handler: async (input, ctx) => {
      const { context } = input as ToolInput<"context.get">;
      const seen = await checkVisible(ctx, context);
      if (!seen.ok) return seen;
      const read = await readContext(ctx.core, context, async (id) => {
        const project = await readOf(ctx.core, projectApi.get, {
          project: id,
        });
        return project.ok ? ok(project.value.project) : project;
      });
      if (read === null || read.text === null) {
        return notFound("the context has no applied version to read");
      }
      const output = contextGetOutputSchema.parse({
        version: read.version,
        text: renderContextText(read.text, "full"),
      });
      return ok(fitted(`context ${read.name} ${output.version}`, output));
    },
  }),
  defineTool({
    name: "context.search",
    input: TOOL_INPUTS["context.search"],
    routes: [
      ...CONTEXT_ACCESS_ROUTES,
      contextContractRoute,
      contextSearchRoute,
    ],
    description:
      "Run one search of a context: give the context, the search name and its inputs (see context.get for the searches). Returns entity rows with their file path and section.",
    effect: "read",
    handler: async (input, ctx) => {
      const args = input as ToolInput<"context.search">;
      const seen = await checkVisible(ctx, args.context);
      if (!seen.ok) return seen;
      return searchContext(ctx, args);
    },
  }),
  defineTool({
    name: "context.violations",
    input: TOOL_INPUTS["context.violations"],
    routes: [...CONTEXT_ACCESS_ROUTES, contextViolationsRoute],
    description:
      "List the contract violations of a context: kind, rule, file path, section and message.",
    effect: "read",
    handler: async (input, ctx) => {
      const { context } = input as ToolInput<"context.violations">;
      const seen = await checkVisible(ctx, context);
      if (!seen.ok) return seen;
      const read = await readOf(ctx.core, contextViolationsRoute, { context });
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("violations", body.violations.length, more),
        body,
        ["violations"],
      ));
    },
  }),
  defineTool({
    name: "context.test",
    input: TOOL_INPUTS["context.test"],
    routes: [bundleTestDraftRoute],
    description:
      "Run a draft in isolation and report whether the contract passes: status and findings. Nothing is applied.",
    effect: "read",
    handler: async (input, ctx) => {
      const { draft } = input as ToolInput<"context.test">;
      const read = await readOf(ctx.core, bundleTestDraftRoute, {
        bundle: draft,
      });
      if (!read.ok) return read;
      const { report } = read.value;
      return ok(fitted(
        `draft test ${report.status}, ${report.findings.length} findings`,
        { report },
        ["report"],
      ));
    },
  }),
  defineTool({
    name: "context.draft",
    input: TOOL_INPUTS["context.draft"],
    routes: [bundleOpenDraftRoute],
    description:
      "Open the folder of a new draft. With context, it is a new version of that context. Without context, give name and purpose and a new context is made with its first draft. Write the contract and the search scripts into the returned folder with file.write, then context.test and context.submit.",
    effect: "write",
    handler: (input, ctx) =>
      openDraft(ctx, input as ToolInput<"context.draft">),
  }),
  defineTool({
    name: "context.submit",
    input: TOOL_INPUTS["context.submit"],
    routes: [bundleSubmitRoute],
    description:
      "Submit a draft. It is checked and applied automatically when it passes; until then other agents keep using the current version.",
    effect: "write",
    handler: async (input, ctx) => {
      const { draft } = input as ToolInput<"context.submit">;
      const done = await commandOf(
        ctx.core,
        bundleSubmitRoute,
        { bundle: draft },
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(
        fitted(`draft ${draft} is ${done.value.status}`, done.value),
      );
    },
  }),
  defineTool({
    name: "glossary.set",
    input: TOOL_INPUTS["glossary.set"],
    routes: [glossaryListRoute, glossaryRemoveRoute, glossarySetRoute],
    description:
      "Set the meaning of a term of a context, or change it. With remove true the term is deleted. The glossary is part of the text context.get returns.",
    effect: "write",
    handler: (input, ctx) =>
      setGlossary(ctx, input as ToolInput<"glossary.set">),
  }),
];
