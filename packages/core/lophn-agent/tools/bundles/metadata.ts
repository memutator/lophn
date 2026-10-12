import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import { appGet, appIdSchema, appList } from "../../../../protocol/apps/mod.ts";
import {
  projectGet,
  projectIdSchema,
  projectList,
  readCursorSchema,
} from "../../../../protocol/projects/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { archiveStateSchema } from "../../../../protocol/server/mod.ts";
import { fitJson, PAGE_SIZE } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { bodyOf, resume, scopeOf, windowedResult } from "./paging.ts";

// project·app 목적 묶음(concern harness/tools, roles/context-engineer R4). 프로젝트와 앱의 이름·
// 목적·상태만 읽기로 준다. 앱 소스 경로·실행 상태·폴더 경로는 결과에 싣지 않고 앱 command는 호출하지
// 않는다. 앱 blueprint의 command 목록(`app.commands`)은 앱 묶음(`app.ts`)이 읽는다.

export const METADATA_TOOL_REVISION = "2026-10-06";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    METADATA_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const cursor = { cursor: readCursorSchema.optional() };
const listInput = z.strictObject({
  status: archiveStateSchema.optional(),
  ...cursor,
});
const projectReadInput = z.strictObject({ project: projectIdSchema });
const appReadInput = z.strictObject({ app: appIdSchema });

export const projectListTool = define(
  "project.list",
  "List projects: name, title, purpose, and status. This changes nothing.",
  listInput,
  projectList.name,
  { ...READ, scopeCheck: "projects the assignment may read" },
);
export const projectReadTool = define(
  "project.read",
  "Read one project: purpose, status, and its documents as fixed references. This changes nothing.",
  projectReadInput,
  projectGet.name,
  { ...READ, scopeCheck: "projects the assignment may read" },
);
export const appListTool = define(
  "app.list",
  "List apps: name, description, and status. This changes nothing.",
  listInput,
  appList.name,
  { ...READ, scopeCheck: "apps the assignment may read" },
);
export const appReadPurposeTool = define(
  "app.read_purpose",
  "Read the purpose of one app: name, description, and status. No source, release, or command is read.",
  appReadInput,
  appGet.name,
  { ...READ, scopeCheck: "apps the assignment may read" },
);

export const METADATA_TOOL_NAMES: readonly string[] = [
  projectListTool.name,
  projectReadTool.name,
  appListTool.name,
  appReadPurposeTool.name,
];

export const METADATA_TOOLS: readonly ToolDefinition[] = [
  projectListTool,
  projectReadTool,
  appListTool,
  appReadPurposeTool,
];

export type MetadataToolPorts = ContractCall;

type ProjectRecord = {
  id: string;
  name: string;
  title: string;
  purpose: string;
  status: string;
  revision: string;
  documents?: unknown[];
};
type AppRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  planning_version: string | null;
  status: string;
  revision: string;
};

function projectSummary(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    title: project.title,
    purpose: project.purpose,
    status: project.status,
    revision: project.revision,
  };
}

// 앱의 소스 경로·활성 release·실행 허용은 목적이 아니다. 결과에 싣지 않는다.
function appSummary(app: AppRecord) {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    planning_version: app.planning_version,
    status: app.status,
  };
}

export function createMetadataToolHandlers(
  ports: MetadataToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  function listHandler(
    tool: ToolDefinition,
    contract: string,
    summary: string,
    key: "projects" | "apps",
    shape: (record: never) => unknown,
  ): ToolHandler {
    return async (input, credential) => {
      const value = input as z.infer<typeof listInput>;
      const scope = scopeOf(tool.name, { status: value.status ?? null });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(contract, {
        ...(value.status === undefined ? {} : { status: value.status }),
        limit: PAGE_SIZE,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const items = ((body[key] ?? []) as never[]).map(shape);
      return ok(windowedResult(
        summary,
        scope,
        key,
        items,
        resumed.value?.skip ?? 0,
        inner,
        body,
        { as_of_seq: body.as_of_seq ?? null },
      ));
    };
  }

  handlers.set(
    projectListTool.name,
    listHandler(
      projectListTool,
      projectList.name,
      "projects listed",
      "projects",
      projectSummary as (record: never) => unknown,
    ),
  );
  handlers.set(
    appListTool.name,
    listHandler(
      appListTool,
      appList.name,
      "apps listed",
      "apps",
      appSummary as (record: never) => unknown,
    ),
  );

  handlers.set(
    projectReadTool.name,
    async (input, credential) => {
      const read = await ports.call(projectGet.name, input, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const project = body["project"] as ProjectRecord;
      const fitted = fitJson({
        project: projectSummary(project),
        documents: project.documents ?? [],
        as_of_seq: body.as_of_seq ?? null,
      }, ["documents"]);
      return ok({
        status: "success",
        summary: "project read",
        content: fitted.content as ToolResult["content"],
        complete: fitted.complete,
        source: null,
        continuation: null,
        pending: [],
      });
    },
  );
  handlers.set(
    appReadPurposeTool.name,
    async (input, credential) => {
      const read = await ports.call(appGet.name, input, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const fitted = fitJson({
        app: appSummary(body["app"] as AppRecord),
        as_of_seq: body.as_of_seq ?? null,
      }, []);
      return ok({
        status: "success",
        summary: "app purpose read",
        content: fitted.content as ToolResult["content"],
        complete: fitted.complete,
        source: null,
        continuation: null,
        pending: [],
      });
    },
  );
  return handlers;
}
