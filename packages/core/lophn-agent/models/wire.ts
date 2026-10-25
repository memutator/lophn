import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import {
  type CatalogEntry,
  EFFORT_BUDGET_TOKENS,
  OPTION_AXIS_EFFORT,
  type OptionAxis,
  type OptionWire,
  type PROVIDER_PROTOCOLS,
} from "../../../protocol/lophn-agent/mod.ts";
import type { JsonObject, JsonValue } from "../../../protocol/base/mod.ts";

// option 값을 호출 형식의 요청으로 옮기는 곳이다. 호출 형식마다 effort를
// 요청 필드로 옮기는 표가 하나씩 있고, effort 밖 값은 catalog가 선언한 wire(body patch 또는
// model id 바꾸기)를 그대로 쓴다. model 이름으로 갈라지는 분기는 어디에도 두지 않는다.

type WireProtocol = (typeof PROVIDER_PROTOCOLS)[number];

type WirePlan = {
  // 요청에 실을 model 이름. model_id wire가 있으면 바뀐 이름, 없으면 entry.model_name.
  sent_model_name: string;
  // 요청 body에 합칠 조각. 조각이 겹치면 깊게 합친다.
  request_patch: JsonObject;
  // body_patch wire가 싣는 header. 같은 이름은 축 순서대로 쉼표로 잇고(같은 값은 한 번만)
  // 이름이 다르면 따로 둔다. 없으면 {}.
  request_headers: Record<string, string>;
};

type EffortPiece = (
  value: string,
  axis: OptionAxis,
) => JsonObject | undefined;

// 표에 없는 effort 값은 undefined다. 가까운 값으로 바꾸지 않는다.
function lookup(
  table: Readonly<Record<string, string>>,
  value: string,
): string | undefined {
  return Object.hasOwn(table, value) ? table[value] : undefined;
}

const MESSAGES_EFFORT_NAMES: Readonly<Record<string, string>> = {
  low: "low",
  medium: "medium",
  high: "high",
  very_high: "xhigh",
  maximum: "max",
};

// 예산 축이면 확인된 최소·최대 안으로 제한한 thinking 예산을, 아니면 effort 이름을 싣는다.
const messagesEffort: EffortPiece = (value, axis) => {
  if (value === "off") {
    const piece: JsonObject = { thinking: { type: "disabled" } };
    return piece;
  }
  if (axis.budget !== null) {
    if (!Object.hasOwn(EFFORT_BUDGET_TOKENS, value)) return undefined;
    const base =
      EFFORT_BUDGET_TOKENS[value as keyof typeof EFFORT_BUDGET_TOKENS];
    const budget = Math.min(
      Math.max(base, axis.budget.minimum),
      axis.budget.maximum,
    );
    const piece: JsonObject = {
      thinking: { type: "enabled", budget_tokens: budget },
    };
    return piece;
  }
  const name = lookup(MESSAGES_EFFORT_NAMES, value);
  if (name === undefined) return undefined;
  // 지금 Claude model의 adaptive thinking은 기본 display가 "omitted"라 사고 글이 빈 채로
  // 온다. 화면에 보일 요약을 받으려면 요청에 summarized를 싣는다. budget 쪽은 기본이 요약이다.
  const piece: JsonObject = {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: name },
  };
  return piece;
};

const REASONING_EFFORT_NAMES: Readonly<Record<string, string>> = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  very_high: "xhigh",
};

const responsesEffort: EffortPiece = (value) => {
  const name = lookup(REASONING_EFFORT_NAMES, value);
  if (name === undefined) return undefined;
  // 요약 글을 받으려면 요청에 summary를 실어야 한다. "none"(off)은 요약이 없다.
  const piece: JsonObject = name === "none"
    ? { reasoning: { effort: name } }
    : { reasoning: { effort: name, summary: "auto" } };
  return piece;
};

// Chat Completions 호환 server(deepseek-v4 계열)는 max를 받는다. OpenAI Responses는 받지 않는다.
const CHAT_EFFORT_NAMES: Readonly<Record<string, string>> = {
  ...REASONING_EFFORT_NAMES,
  maximum: "max",
};

const chatEffort: EffortPiece = (value) => {
  const name = lookup(CHAT_EFFORT_NAMES, value);
  return name === undefined ? undefined : { reasoning_effort: name };
};

const EFFORT_TABLES: Readonly<Record<WireProtocol, EffortPiece>> = {
  "anthropic-messages": messagesEffort,
  "openai-responses": responsesEffort,
  "openai-chat-completions": chatEffort,
};

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 같은 키가 양쪽에 있으면 안으로 들어가 합친다. 객체가 아닌 값이 서로 다르면 어느 쪽도
// 고르지 않고 실패한다(조용히 덮어쓰지 않는다).
function mergeInto(
  target: JsonObject,
  piece: JsonObject,
  path: string,
): string | null {
  for (const [key, incoming] of Object.entries(piece)) {
    const here = path === "" ? key : `${path}.${key}`;
    if (!Object.hasOwn(target, key)) {
      target[key] = incoming;
      continue;
    }
    const existing = target[key];
    if (isJsonObject(existing) && isJsonObject(incoming)) {
      const conflict = mergeInto(existing, incoming, here);
      if (conflict !== null) return conflict;
    } else if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
      return here;
    }
  }
  return null;
}

function addHeaders(
  headers: Record<string, string>,
  incoming: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(incoming)) {
    if (!Object.hasOwn(headers, name)) {
      headers[name] = value;
      continue;
    }
    const joined = headers[name].split(",");
    if (!joined.includes(value)) headers[name] = [...joined, value].join(",");
  }
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// option_values는 options.ts가 default를 채운 뒤의 값이다(없는 축은 요청에 필드가 없다).
// 없는 축·값이거나 그 호출 형식의 표에 없는 effort 값이면 다른 값으로 바꾸지 않고
// invalid_input으로 실패한다.
export function translateOptions(
  input: {
    protocol: WireProtocol;
    entry: CatalogEntry;
    option_values: Readonly<Record<string, string>>;
  },
): Result<WirePlan> {
  const { protocol, entry, option_values } = input;
  const axes = entry.options ?? [];
  const declared = new Set(axes.map((axis) => axis.id));
  for (const id of Object.keys(option_values)) {
    if (!declared.has(id)) return invalid(`option axis is not declared: ${id}`);
  }

  const request_patch: JsonObject = {};
  const request_headers: Record<string, string> = {};
  let sent_model_name = entry.model_name;
  let renamedBy: string | null = null;

  // 축 순서대로 처리해서 header 값이 늘 같은 순서로 이어진다.
  for (const axis of axes) {
    if (!Object.hasOwn(option_values, axis.id)) continue;
    const value = option_values[axis.id];
    const declaredValue = axis.values.find((candidate) =>
      candidate.value === value
    );
    if (declaredValue === undefined) {
      return invalid(`option value is not declared: ${axis.id}=${value}`);
    }
    const wire: OptionWire | null = declaredValue.wire;
    let piece: JsonObject | undefined;
    if (wire === null) {
      if (axis.id !== OPTION_AXIS_EFFORT) {
        return invalid(`option value has no wire: ${axis.id}=${value}`);
      }
      piece = EFFORT_TABLES[protocol](value, axis);
      if (piece === undefined) {
        return invalid(`${protocol} cannot express ${axis.id}=${value}`);
      }
    } else if (wire.kind === "model_id") {
      if (renamedBy !== null && sent_model_name !== wire.model_name) {
        return invalid(`${renamedBy} and ${axis.id} send different model ids`);
      }
      sent_model_name = wire.model_name;
      renamedBy = axis.id;
      continue;
    } else {
      piece = wire.patch;
      if (wire.headers !== undefined) addHeaders(request_headers, wire.headers);
    }
    const conflict = mergeInto(request_patch, structuredClone(piece), "");
    if (conflict !== null) {
      return invalid(`option pieces disagree on ${conflict}`);
    }
  }
  return ok({ sent_model_name, request_patch, request_headers });
}
