import { z } from "zod";
import { projectGet, projectList, projectResolveCwd } from "../projects/mod.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";

const projectInput = z.discriminatedUnion("op", [
  projectList.input.extend({ op: z.literal("list") }),
  projectGet.input.extend({ op: z.literal("show") }),
  // cwd는 caller 입력이 아니다. 빈 객체가 project.resolve_cwd의 입력이다.
  projectResolveCwd.input.extend({ op: z.literal("current") }),
]);

export const MCP_CORE_TOOLS = [
  {
    name: "lophn_project",
    toolset: "core",
    scope: "S",
    input: projectInput,
    ops: ["list", "show", "current"],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  scope: ScopeMark;
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpCoreToolName = (typeof MCP_CORE_TOOLS)[number]["name"];

export const MCP_CORE_ROUTES = {
  lophn_project: {
    list: projectList,
    show: projectGet,
    current: projectResolveCwd,
  },
} as const;

export function mcpCoreTool(name: string) {
  const tool = MCP_CORE_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}

// current는 caller cwd를 받지 않는다. 빈 입력이 resolve_cwd의 입력과 같다.
export const projectCurrentInputSchema = projectResolveCwd.input;
