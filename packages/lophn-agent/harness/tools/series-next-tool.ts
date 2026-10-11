// context series kind의 다음 이름 읽기 tool(lophn-agent/harness/tools#R24)의 spec stub이다. 구현은
// ctx-I58e가 한다(d-plan I61 뒤). 옛 series 가족 읽기 통로(`series.next`, documents/series#R9)를 대체한다.
// 문서를 만들거나 series를 등록·변경하지 않고 이름만 돌려준다. 문서를 저장하는 일은 각 역할의 문서 저장
// 범위를 따르는 다른 tool의 몫이다.
import type { ContractCall } from "./bundles/common.ts";
import {
  CONTEXT_SERIES_NEXT_CONTRACT,
  type SeriesNextRead,
} from "./context-route-shapes.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolHandler } from "./work.ts";

export const SERIES_NEXT_TOOL = "context.series_next";

// route(`context.series_next`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export const SERIES_NEXT_CONTRACT = CONTEXT_SERIES_NEXT_CONTRACT;
export type { SeriesNextRead };

// I58e가 채운다. harness/tools의 `BUILTIN_TOOLS`가 더하고 역할 상한 이름 표가 Operator와 lophn에게 연다.
export const SERIES_NEXT_TOOLS: readonly ToolDefinition[] = [];

export function createSeriesNextToolHandlers(
  _ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  throw new Error("not implemented");
}
