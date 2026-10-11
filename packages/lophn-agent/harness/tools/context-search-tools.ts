// 선언 검색마다 읽기 tool 하나와 개체 하나 읽기 tool(lophn-agent/harness/tools#R21, R22)의 spec stub이다.
// 구현은 ctx-I56이 한다. `buildAppTools`/`createAppToolHandlers`와 같은 모양으로 선언에서 정의를 만들고
// 정의마다 handler를 묶는다. 옛 context 묶음(`bundles/context.ts`)은 ctx-R6이 지울 때까지 그대로 둔다.
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import type { ContractCall } from "./bundles/common.ts";
import {
  CONTEXT_ENTITY_CONTRACT,
  type ContextEntityRead,
} from "./context-route-shapes.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolHandler } from "./work.ts";

// 선언 검색 tool이 부르는 core contract다(`context.search` 읽기 route).
export const CONTEXT_SEARCH_CONTRACT = "context.search";

// 개체 하나 읽기 tool의 이름이다. route(`context.entity`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export const CONTEXT_ENTITY_TOOL = "context.read_entity";
export { CONTEXT_ENTITY_CONTRACT, type ContextEntityRead };

// run을 시작할 때 읽은 적용된 판이다. 판이 바뀌어도 진행 중인 run은 이 값으로 계속하고 새 정의는
// 다음 run부터 쓴다(R21).
export type ContextToolContext = {
  id: string;
  title: string;
  bundle_hash: string;
  content: BundleContent;
};

export type ContextSearchToolSource = {
  // preset이 고른 context들(prompt 자료와 같은 선택).
  selected: readonly ContextToolContext[];
  // 역할 상한·assignment 범위가 읽게 하는 context id. null이면 역할 상한이 더 줄이지 않는다.
  allowed: ReadonlySet<string> | null;
};

export type ContextSearchTool = {
  definition: ToolDefinition;
  context: string;
  search: string;
  bundleHash: string;
};

export type ContextReadTools = {
  // selected ∩ allowed인 context의 선언 검색마다 하나.
  search: readonly ContextSearchTool[];
  // 도달 가능한 context가 하나라도 있을 때만 있다.
  entity: ToolDefinition | null;
  // 이 tool들이 닿는 context id(개체 읽기가 이 밖의 context를 not_found로 거절한다).
  contexts: readonly string[];
};

export function buildContextReadTools(
  _source: ContextSearchToolSource,
): Promise<ContextReadTools> {
  throw new Error("not implemented");
}

// 목록에 넣을 정의: 선언 검색 tool들 다음에 개체 읽기 tool.
export function contextReadDefinitions(
  _tools: ContextReadTools,
): readonly ToolDefinition[] {
  throw new Error("not implemented");
}

export function createContextReadToolHandlers(
  _tools: ContextReadTools,
  _ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  throw new Error("not implemented");
}
