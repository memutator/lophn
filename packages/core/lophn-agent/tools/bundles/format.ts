import { z } from "zod";
import { fingerprint, ok, type Result } from "../../../../base/mod.ts";
import {
  builtinFormatNameSchema,
  formatGet,
  formatList,
  readCursorSchema,
} from "../../../../protocol/projects/mod.ts";
import {
  toolFormatSchema,
  type ToolResult,
  toolTextMediaTypeSchema,
  toolTextSchema,
  validateToolText,
} from "../../../../protocol/lophn-agent/mod.ts";
import { sha256Schema } from "../../../../protocol/base/mod.ts";
import { fitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
} from "./common.ts";
import { bodyOf, resume, scopeOf, windowedResult } from "./paging.ts";

// format 묶음(concern harness/tools R7). format 목록·규칙·예시·본문 검사를 읽기로만 준다. 검사는
// 본문을 글 값으로 core에 넘겨 결과만 받고, 검사한 본문을 Document·Version으로 저장하지 않는다.
// 검사는 model을 부르지 않는 결정적 계산이다(roles/common R9).

export const FORMAT_TOOL_REVISION = "2026-10-06";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    FORMAT_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const listInput = z.strictObject({});
const ruleInput = z.strictObject({
  name: builtinFormatNameSchema,
  module_hash: sha256Schema,
});
const validateInput = z.strictObject({
  format: toolFormatSchema,
  text: toolTextSchema,
  media_type: toolTextMediaTypeSchema,
  cursor: readCursorSchema.optional(),
});

const SCOPE = "document formats";

export const formatListTool = define(
  "format.list",
  "List the document formats: name, module hash, and media types. This changes nothing.",
  listInput,
  formatList.name,
  { ...READ, scopeCheck: SCOPE },
);
export const formatRulesTool = define(
  "format.rules",
  "Read the rules of one format: structure, metadata, vocabulary, and the guide. This changes nothing.",
  ruleInput,
  formatGet.name,
  { ...READ, scopeCheck: SCOPE },
);
export const formatExamplesTool = define(
  "format.examples",
  "Read the examples of one format. This changes nothing.",
  ruleInput,
  formatGet.name,
  { ...READ, scopeCheck: SCOPE },
);
export const formatValidateTool = define(
  "format.validate",
  "Check text against a format and read the diagnostics. The text is not saved as a document.",
  validateInput,
  validateToolText.name,
  { ...READ, scopeCheck: SCOPE },
);

export const FORMAT_TOOL_NAMES: readonly string[] = [
  formatListTool.name,
  formatRulesTool.name,
  formatExamplesTool.name,
  formatValidateTool.name,
];

export const FORMAT_TOOLS: readonly ToolDefinition[] = [
  formatListTool,
  formatRulesTool,
  formatExamplesTool,
  formatValidateTool,
];

export type FormatToolPorts = ContractCall;

type Declaration = {
  name: string;
  module_hash: string;
  media_types: unknown;
  structure: unknown;
  metadata: unknown;
  guide: { text: string; examples: string[] };
  vocabulary: unknown;
  extracts: boolean;
};

function fitted(summary: string, value: Record<string, unknown>): ToolResult {
  const limited = fitJson(value, []);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function createFormatToolHandlers(
  ports: FormatToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(
    formatListTool.name,
    async (_input, credential: RunCredential) => {
      const read = await ports.call(formatList.name, {}, credential.run);
      if (!read.ok) return read;
      const formats = (bodyOf(read.value)["formats"] ?? []) as Declaration[];
      // 선언 전체(template·guide)는 규칙·예시 tool이 읽는다. 목록은 이름·묶음 hash·형식만이다.
      return ok(fitted("formats listed", {
        formats: formats.map((format) => ({
          name: format.name,
          module_hash: format.module_hash,
          media_types: format.media_types,
          extracts: format.extracts,
        })),
      }));
    },
  );

  async function declaration(
    input: unknown,
    credential: RunCredential,
  ): Promise<Result<Declaration>> {
    const read = await ports.call(formatGet.name, input, credential.run);
    if (!read.ok) return read;
    return ok(read.value as Declaration);
  }

  handlers.set(
    formatRulesTool.name,
    async (input, credential) => {
      const found = await declaration(input, credential);
      if (!found.ok) return found;
      const format = found.value;
      return ok(fitted("format rules read", {
        name: format.name,
        module_hash: format.module_hash,
        media_types: format.media_types,
        structure: format.structure,
        metadata: format.metadata,
        vocabulary: format.vocabulary,
        extracts: format.extracts,
        guide: format.guide.text,
      }));
    },
  );
  handlers.set(
    formatExamplesTool.name,
    async (input, credential) => {
      const found = await declaration(input, credential);
      if (!found.ok) return found;
      const format = found.value;
      return ok(fitted("format examples read", {
        name: format.name,
        module_hash: format.module_hash,
        examples: format.guide.examples,
      }));
    },
  );

  // 검사 결과 진단 page. 본문은 core로만 가고 결과의 진단은 한 page에 20개씩 보인다.
  handlers.set(
    formatValidateTool.name,
    async (input, credential) => {
      const value = input as z.infer<typeof validateInput>;
      // 같은 본문·format의 검사만 같은 cursor로 이어진다.
      const scope = scopeOf("format.validate", {
        format: value.format,
        media_type: value.media_type,
        text: await fingerprint(value.text),
      });
      const resumed = resume(value.cursor, scope);
      if (!resumed.ok) return resumed;
      const inner = resumed.value?.inner ?? null;
      const read = await ports.call(validateToolText.name, {
        format: value.format,
        text: value.text,
        media_type: value.media_type,
        ...(inner === null ? {} : { cursor: inner }),
      }, credential.run);
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const diagnostics = (body["diagnostics"] ?? []) as unknown[];
      const status = String(body["status"] ?? "failed");
      return ok(windowedResult(
        status === "passed" ? "format check passed" : "format check failed",
        scope,
        "diagnostics",
        diagnostics,
        resumed.value?.skip ?? 0,
        inner,
        body,
        {
          status,
          error_count: body["error_count"] ?? 0,
          warning_count: body["warning_count"] ?? 0,
          input_hash: body["input_hash"] ?? null,
          module_hash: body["module_hash"] ?? null,
          diagnostics_offset: Number(body["diagnostics_offset"] ?? 0) +
            (resumed.value?.skip ?? 0),
        },
      ));
    },
  );
  return handlers;
}
