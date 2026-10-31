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

// Gemini Schema는 type에 문자열 하나만 받는다. JSON Schema의 타입 배열(`["string","number"]`)과
// bool schema는 그대로 보낼 수 없어, 같은 뜻의 anyOf로 펼친다. Zod의 union이 타입 배열로 나오고
// 그 배열이 anyOf 안에 중첩되어도 백엔드가 거절하므로 깊이와 무관하게 편다.
// `null`은 타입에서 빼고 nullable로 옮긴다. Gemini의 bool은 anyOf 갈래로 표현할 수 없다.
type JsonObject = Record<string, unknown>;

// 스칼라 타입 배열을 anyOf 갈래로 푼다. null만 남으면 원래 노드를 유지한다(표현할 타입이 없다).
// 이미 anyOf가 있으면 두 제약을 모두 만족해야 하므로 allOf로 묶는다. 덮어쓰면 조건이 넓어진다.
function scalarizeTypes(schema: JsonObject): JsonObject {
  const declared = schema["type"];
  if (!Array.isArray(declared) || declared.length === 0) return schema;
  const types = declared.filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  const nonNull = types.filter((value) => value.toLowerCase() !== "null");
  if (nonNull.length === 0) return schema;
  const rest: JsonObject = { ...schema };
  delete rest["type"];
  if (types.length !== nonNull.length) rest["nullable"] = true;
  // 남은 타입이 하나면 type 하나로 충분하다. 그 이상은 anyOf로 펼쳐야 한다.
  if (nonNull.length === 1) return { ...rest, type: nonNull[0] };
  const branches = nonNull.map((type) => ({ type }));
  const existing = rest["anyOf"];
  if (Array.isArray(existing)) {
    delete rest["anyOf"];
    const allOf = Array.isArray(rest["allOf"]) ? rest["allOf"] : [];
    return {
      ...rest,
      allOf: [...allOf, { anyOf: existing }, { anyOf: branches }],
    };
  }
  return { ...rest, anyOf: branches };
}

// 스키마 트리 전체를 방문해 타입 배열과 bool schema를 백엔드가 받는 모양으로 바꾼다.
// properties·items·anyOf·oneOf·allOf·not의 하위까지 내려간다. 입력은 바꾸지 않는다.
// bool 갈래는 false를 뺀다(아무것도 받지 않는 갈래다). true가 있으면 그 조합은 무엇이든 받으므로
// 조합 자체를 지워 열린 스키마로 남긴다.
export function normalizeTypeArrays(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTypeArrays(item));
  }
  if (typeof value !== "object" || value === null) return value;
  const source = value as JsonObject;
  const schema: JsonObject = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "properties" && typeof child === "object" && child !== null) {
      const properties = child as JsonObject;
      schema[key] = Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [
          name,
          normalizeTypeArrays(property),
        ]),
      );
      continue;
    }
    schema[key] = normalizeTypeArrays(child);
  }
  const typed = scalarizeTypes(schema);
  for (const combiner of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = typed[combiner];
    if (!Array.isArray(branches)) continue;
    if (branches.includes(true)) {
      delete typed[combiner];
      continue;
    }
    const kept = branches.filter((branch) => branch !== false);
    if (kept.length === 0) {
      delete typed[combiner];
      continue;
    }
    if (kept.length === 1) {
      delete typed[combiner];
      const [only] = kept;
      if (typeof only === "object" && only !== null && !Array.isArray(only)) {
        for (const [key, child] of Object.entries(only as JsonObject)) {
          if (!(key in typed)) typed[key] = child;
        }
      }
      continue;
    }
    typed[combiner] = kept;
  }
  return typed;
}

// model에 보이는 정의다. effect와 origin은 registry와 Gate만 읽으므로 싣지 않는다.
// 손으로 만든 inputSchema도 model로 나가므로 같은 정규화를 거친다.

export function inputJsonSchema(
  definition: ToolDefinition,
): Record<string, unknown> {
  if (definition.inputSchema !== undefined) {
    return normalizeTypeArrays(definition.inputSchema) as Record<
      string,
      unknown
    >;
  }
  const schema = z.toJSONSchema(definition.input);
  // tool API가 schema 방언을 정하므로 생성기의 dialect 표시는 반복해서 싣지 않는다.
  delete schema.$schema;
  return normalizeTypeArrays(schema) as Record<string, unknown>;
}
