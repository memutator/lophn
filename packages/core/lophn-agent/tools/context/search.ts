import { z } from "zod";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import {
  type BundleContent,
  contextContractRoute,
  contextSearchRoute,
  type SearchInput,
} from "../../../../protocol/projects/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import { fitted, invalid, notFound } from "../fit-result.ts";
import { PAGE_SIZE } from "../result.ts";
import type { ToolContext } from "../tool-context.ts";

// context 검색 하나를 부른다. 입력은 그 context 적용된 판의 검색 선언으로 검사한다.

function scalar(valueType: string, values: readonly string[] | undefined) {
  switch (valueType) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "enum":
      return values !== undefined && values.length > 0
        ? z.enum(values as [string, ...string[]])
        : z.string();
    // string, date와 그 밖은 글이다.
    default:
      return z.string();
  }
}

// `Type.field`가 가리키는 field의 값 모양. 모르면 글이다.
function fieldSchema(content: BundleContent, of: string | undefined) {
  const [typeName, fieldName] = (of ?? "").split(".");
  const field = content.contract.types.find((type) => type.name === typeName)
    ?.fields.find((entry) => entry.name === fieldName);
  if (field === undefined) return z.string();
  return field.value_type === "list"
    ? scalar(field.item_type ?? "string", field.values)
    : scalar(field.value_type, field.values);
}

function inputSchema(content: BundleContent, input: SearchInput): z.ZodType {
  let base: z.ZodType;
  if (input.type === "range") {
    const bound = fieldSchema(content, input.of);
    base = z.strictObject({
      from: bound.optional(),
      to: bound.optional(),
    });
  } else if (input.type === "value") {
    base = fieldSchema(content, input.of);
  } else {
    // text는 글이고 entity는 개체 key 글이다.
    base = z.string();
  }
  const shaped = input.many ? z.array(base) : base;
  return input.required ? shaped : shaped.optional();
}

export async function searchContext(
  ctx: ToolContext,
  args: { context: string; search: string; input: Record<string, unknown> },
): Promise<Result<ToolResult>> {
  const contract = await readOf(ctx.core, contextContractRoute, {
    context: args.context,
  });
  if (!contract.ok) return contract;
  const { content } = contract.value;
  if (content === null) return notFound("the context has no applied version");
  const declared = content.searches.find((entry) => entry.name === args.search);
  if (declared === undefined) return notFound("no such search");

  const shape: Record<string, z.ZodType> = {};
  for (const input of declared.inputs) {
    shape[input.name] = inputSchema(content, input);
  }
  const checked = z.strictObject(shape).safeParse(args.input);
  if (!checked.success) {
    return invalid(
      checked.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    );
  }

  // 결과 상한을 넘으면 fitted가 뒤쪽 행을 덜어 낸다.
  const read = await readOf(ctx.core, contextSearchRoute, {
    context: args.context,
    search: args.search,
    inputs: checked.data,
    page_size: PAGE_SIZE,
  });
  if (!read.ok) return read;
  const { rows, total, bundle_hash, next_cursor } = read.value;
  return ok(fitted(
    `${declared.title}: ${total} in total, ${rows.length} rows${
      next_cursor === null
        ? ""
        : " in this page (narrow the inputs to see the rest)"
    }`,
    { context: args.context, search: args.search, bundle_hash, total, rows },
    ["rows"],
  ));
}
