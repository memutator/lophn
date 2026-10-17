import { ok, type Result } from "../../../base/mod.ts";
import { appGet } from "../../../protocol/apps/mod.ts";
import { agentDefinitionRead } from "../../../protocol/lophn-agent/mod.ts";
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
} from "../../../protocol/projects/mod.ts";
import { contextGetOutputSchema } from "../../../protocol/lophn-agent/context-text.ts";
import { readContext } from "../../lophn-agent/run-loop/place-data.ts";
import { renderContextText } from "../../lophn-agent/prompt-assembly/mod.ts";
import { openDraft, setGlossary } from "./context/draft.ts";
import { searchContext } from "./context/search.ts";
import { checkVisible, contextAccess } from "./context/visible.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  notFound,
  readBody,
  readOf,
  type ToolContext,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const none = z.strictObject({});

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
    input: none,
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
    input: z.strictObject({ context: idSchema("ctx") }),
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
      const { context } = input;
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
    input: z.strictObject({
      context: idSchema("ctx"),
      search: nonblank,
      input: z.record(z.string(), z.unknown()),
    }),
    routes: [
      ...CONTEXT_ACCESS_ROUTES,
      contextContractRoute,
      contextSearchRoute,
    ],
    description:
      "Run one search of a context: give the context, the search name and its inputs (see context.get for the searches). Returns entity rows with their file path and section.",
    effect: "read",
    handler: async (input, ctx) => {
      const args = input;
      const seen = await checkVisible(ctx, args.context);
      if (!seen.ok) return seen;
      return searchContext(ctx, args);
    },
  }),
  defineTool({
    name: "context.violations",
    input: z.strictObject({ context: idSchema("ctx") }),
    routes: [...CONTEXT_ACCESS_ROUTES, contextViolationsRoute],
    description:
      "List the contract violations of a context: kind, rule, file path, section and message.",
    effect: "read",
    handler: async (input, ctx) => {
      const { context } = input;
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
    input: z.strictObject({
      context: idSchema("ctx"),
      draft: idSchema("cbn"),
    }),
    routes: [bundleTestDraftRoute],
    description:
      "Run a draft in isolation and report whether the contract passes: status and findings. Nothing is applied.",
    effect: "read",
    handler: async (input, ctx) => {
      const { draft } = input;
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
    input: z.strictObject({
      context: idSchema("ctx").optional(),
      name: nonblank.optional(),
      purpose: nonblank.optional(),
    }),
    routes: [bundleOpenDraftRoute],
    description:
      "Open the folder of a new draft. With context, it is a new version of that context. Without context, give name and purpose and a new context is made with its first draft. Write the contract and the search scripts into the returned folder with file.write, then context.test and context.submit.",
    effect: "write",
    handler: (input, ctx) => openDraft(ctx, input),
  }),
  defineTool({
    name: "context.submit",
    input: z.strictObject({
      context: idSchema("ctx"),
      draft: idSchema("cbn"),
    }),
    routes: [bundleSubmitRoute],
    description:
      "Submit a draft. It is checked and applied automatically when it passes; until then other agents keep using the current version.",
    effect: "write",
    handler: async (input, ctx) => {
      const { draft } = input;
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
    input: z.strictObject({
      context: idSchema("ctx"),
      term: nonblank,
      meaning: z.string(),
      remove: z.boolean().optional(),
    }),
    routes: [glossaryListRoute, glossaryRemoveRoute, glossarySetRoute],
    description:
      "Set the meaning of a term of a context, or change it. With remove true the term is deleted. The glossary is part of the text context.get returns.",
    effect: "write",
    handler: (input, ctx) => setGlossary(ctx, input),
  }),
];
