import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../../protocol/lophn-agent/tool-catalog.ts";
import type { ToolDefinition } from "./registry.ts";

// model에는 wire 이름으로 보내고, 돌아온 이름은 표로 거꾸로 찾는다. 이름을 parse하지 않는다.

type WireTable = ReadonlyMap<string, ToolDefinition>;

// 같은 wire 이름이 둘이거나 wire 이름이 형식에 맞지 않으면 오류다. session을 시작할 때 목록으로 한 번 만든다.
export function buildWireTable(
  definitions: readonly ToolDefinition[],
): Result<WireTable> {
  const table = new Map<string, ToolDefinition>();
  for (const definition of definitions) {
    const wire = toWireToolName(definition.name);
    if (!WIRE_TOOL_NAME_PATTERN.test(wire)) {
      return err({
        code: "invalid_input",
        message: `tool name is not a valid wire name: ${definition.name}`,
      });
    }
    if (table.has(wire)) {
      return err({
        code: "conflict",
        message: `two tools share the wire name ${wire}`,
      });
    }
    table.set(wire, definition);
  }
  return ok(table);
}

const tables = new WeakMap<readonly ToolDefinition[], Result<WireTable>>();

// 목록 하나에 표 하나를 만들어 둔다. 목록에 없는 이름은 undefined다.
export function toolForWireName(
  definitions: readonly ToolDefinition[],
  name: string,
): ToolDefinition | undefined {
  let table = tables.get(definitions);
  if (table === undefined) {
    table = buildWireTable(definitions);
    tables.set(definitions, table);
  }
  return table.ok ? table.value.get(name) : undefined;
}

// model에 보이는 정의다. effect와 origin은 registry와 Gate만 읽으므로 싣지 않는다.

export function inputJsonSchema(
  definition: ToolDefinition,
): Record<string, unknown> {
  return definition.inputSchema ??
    z.toJSONSchema(definition.input) as Record<string, unknown>;
}
