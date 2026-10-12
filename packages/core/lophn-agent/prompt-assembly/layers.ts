import { canonicalize } from "../../../base/mod.ts";
import type { InstructionLayer } from "../instructions/mod.ts";
import type {
  HistoryMessage,
  PromptMessage,
  PromptPart,
  PromptRequest,
  PromptTool,
  SystemBlock,
  WorkMaterial,
} from "./model.ts";

// 층 본문과 직렬화다. 같은 재료는 같은 값을 낸다. 시각·무작위·입력 순서에 기대지
// 않는다. 경계는 층 구조에서만 나오고 본문 문자열을 찾아 정하지 않는다.

function canonicalValue<T>(value: T): T {
  return JSON.parse(canonicalize(value)) as T;
}

// 이번 call 목록만 이름 순으로 놓고 schema의 key 순서를 고정한다. 목록에 없는 tool은 보태지 않는다.
export function normalizeTools(tools: readonly PromptTool[]): PromptTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: canonicalValue(tool.input_schema),
  })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function layerLabel(layer: InstructionLayer): string {
  return layer.place === null ? layer.kind : `${layer.kind} ${layer.place}`;
}

// 읽은 확정 판의 본문만 층 순서대로 잇는다. 부재·빈 파일은 본문이 없다.
export function instructionsText(layers: readonly InstructionLayer[]): string {
  const sections: string[] = [];
  for (const layer of layers) {
    if (layer.status !== "present" || layer.text === null) continue;
    if (layer.text.trim() === "") continue;
    sections.push(`[사람 지침: ${layerLabel(layer)}]\n${layer.text}`);
  }
  return sections.join("\n\n");
}

// 제품 → 역할(role_agent) → 사람 지침 순의 system 층. 사람 지침이 없으면 그 층은 없다. agent 정의 본문은
// 사람이 쓴 지침이라 사람 지침 층 끝에 온다.
export function systemBlocks(input: {
  product: string;
  role: string;
  instructions: string;
}): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { layer: "product", text: input.product },
    { layer: "role_agent", text: input.role },
  ];
  if (input.instructions !== "") {
    blocks.push({ layer: "user_instructions", text: input.instructions });
  }
  return blocks;
}

function present(text: string | null): text is string {
  return text !== null && text.trim() !== "";
}

// reasoning 본문은 prompt에 넣지 않는다. 조각이 모두 빠진 message는 없다.
function historyMessages(history: readonly HistoryMessage[]): PromptMessage[] {
  const messages: PromptMessage[] = [];
  for (const message of history) {
    const parts: PromptPart[] = [];
    for (const part of message.parts) {
      if (part.kind === "reasoning") continue;
      parts.push(
        part.kind === "tool_use"
          ? { ...part, input: canonicalValue(part.input) }
          : { ...part },
      );
    }
    if (parts.length > 0) messages.push({ role: message.role, parts });
  }
  return messages;
}

// 목적·run 사실 → Compact summary → 자료 → 압축 summary → 이력 → 현재 요청·미반영 steering.
// 없는 부분은 만들지 않고 생략한다. 동적 turn context는 여기 없다.
export function workMessages(material: WorkMaterial): PromptMessage[] {
  const sections: string[] = [];
  if (present(material.purpose)) {
    sections.push(`## 목적·대상\n${material.purpose}`);
  }
  if (present(material.run_facts)) {
    sections.push(`## 현재 run 사실\n${material.run_facts}`);
  }
  if (present(material.compact_summary)) {
    sections.push(`## Compact summary\n${material.compact_summary}`);
  }
  const materials = material.materials.filter((text) => text.trim() !== "");
  if (materials.length > 0) sections.push(`## 자료\n${materials.join("\n\n")}`);
  if (present(material.compaction_summary)) {
    sections.push(`## 압축 summary\n${material.compaction_summary}`);
  }
  const messages: PromptMessage[] = [];
  if (sections.length > 0) {
    messages.push({
      role: "user",
      parts: [{ kind: "text", text: sections.join("\n\n") }],
    });
  }
  messages.push(...historyMessages(material.history));
  const tail: PromptPart[] = [];
  if (material.request !== null) {
    tail.push({ kind: "text", text: material.request });
  }
  for (const text of material.steering) tail.push({ kind: "text", text });
  if (tail.length > 0) messages.push({ role: "user", parts: tail });
  return messages;
}

// 동적 context는 맨 마지막 최신 메시지 끝에만 붙는다. 이력은 바꾸지 않는다. 마지막이 사람
// 쪽 message가 아니면 새 user message로 둔다.
export function withTurnContext(
  messages: readonly PromptMessage[],
  turnContext: string | null,
): PromptMessage[] {
  if (turnContext === null) return [...messages];
  const part: PromptPart = { kind: "text", text: turnContext };
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === "user") {
    return [
      ...messages.slice(0, -1),
      { role: "user", parts: [...last.parts, part] },
    ];
  }
  return [...messages, { role: "user", parts: [part] }];
}

// ---- Anthropic wire 대응 ----
// Anthropic 요청은 tools → system → messages 순이다. 그래서 제품 층 system 끝의 marker가 tools를
// 함께 덮는다. tools에는 marker를 따로 달지 않으므로 논리 경계 세 곳이 wire marker 세 개 이하다.

const EPHEMERAL = { type: "ephemeral" } as const;

export function anthropicSystem(request: PromptRequest) {
  return request.system.map((block) => ({
    type: "text" as const,
    text: block.text,
    cache_control: EPHEMERAL,
  }));
}

export function anthropicTools(request: PromptRequest) {
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}
