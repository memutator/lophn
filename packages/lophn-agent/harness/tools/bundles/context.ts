import { z } from "zod";
import {
  contextIdSchema,
  contextInputSchema,
  contextItemSchema,
  termIdSchema,
} from "../../../../contracts/documents/mod.ts";
import type { ToolDefinition } from "../registry.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";

// Context와 term tool 묶음(lophn-agent/roles/context-engineer#R4, R5).
// 읽기 tool은 context·term 목록·목차·검색·version·절·범위·이력·차이와 app blueprint 명령을
// 읽는다. 쓰기 tool은 context 생성·이름·목적·보관·항목 변경과 term 후보 관리를 제공한다.

export const CONTEXT_TOOL_REVISION = "2026-10-06";

export const CONTEXT_READ_TOOL_NAMES = ["context.list", "term.list"] as const;
export const CONTEXT_WRITE_TOOL_NAMES = ["context.create", "term.propose"] as const;

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    CONTEXT_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

// Read tools for contexts
const contextListInput = z.strictObject({
  cursor: z.string().optional(),
});

const contextGetInput = contextInputSchema;

const termListInput = z.strictObject({
  context: contextIdSchema,
  cursor: z.string().optional(),
});

// Write tools for contexts
const contextCreateInput = z.strictObject({
  id: contextIdSchema,
  title: z.string().min(1),
  purpose: z.string().min(1),
});

const termProposeInput = z.strictObject({
  id: termIdSchema,
  context: contextIdSchema,
  name: z.string().min(1),
});

// Context read tools
const contextListTool = define(
  "context.list",
  "List all contexts",
  contextListInput,
  "documents/contexts",
  {
    effect: "read",
    scopeCheck: "read_any",
    reversible: false,
    idempotent: true,
  },
);

const contextGetTool = define(
  "context.get",
  "Get a specific context",
  contextGetInput,
  "documents/contexts",
  {
    effect: "read",
    scopeCheck: "read_any",
    reversible: false,
    idempotent: true,
  },
);

// Term read tools
const termListTool = define(
  "term.list",
  "List terms in a context",
  termListInput,
  "documents/terms",
  {
    effect: "read",
    scopeCheck: "read_any",
    reversible: false,
    idempotent: true,
  },
);

// Context write tools
const contextCreateTool = define(
  "context.create",
  "Create a new context",
  contextCreateInput,
  "documents/contexts",
  {
    effect: "write",
    scopeCheck: "write_context",
    reversible: true,
    idempotent: false,
  },
);

// Term write tools
const termProposeTool = define(
  "term.propose",
  "Propose a new term candidate",
  termProposeInput,
  "documents/terms",
  {
    effect: "write",
    scopeCheck: "write_context",
    reversible: true,
    idempotent: false,
  },
);

export const CONTEXT_TOOLS: readonly ToolDefinition[] = [
  contextListTool,
  contextGetTool,
  termListTool,
  contextCreateTool,
  termProposeTool,
];
