// context series kind의 다음 이름 읽기 tool(lophn-agent/harness/tools#R24)의 spec stub이다. 구현은
// ctx-I58e가 한다(d-plan I61 뒤). 옛 series 가족 읽기 통로(`series.next`, documents/series#R9)를 대체한다.
// 문서를 만들거나 series를 등록·변경하지 않고 이름만 돌려준다. 문서를 저장하는 일은 각 역할의 문서 저장
// 범위를 따르는 다른 tool의 몫이다.
import type { ContractCall } from "./bundles/common.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolHandler } from "./work.ts";

export const SERIES_NEXT_TOOL = "context.series_next";

// 이 route는 `context-api.ts`에 아직 없다(`packages/documents/contexts/series/next.ts`는 순수 함수만
// 있다). 입력은 `{context, type}`, 읽기 effect이고 결과는 아래 모양으로 가정했다. route를 더하는 task가
// 이 모양에 맞추거나 시험을 고친다.
export const SERIES_NEXT_CONTRACT = "context.series_next";

export type SeriesNextRead = {
  context: string;
  type: string;
  // type의 series pattern
  pattern: string;
  next: {
    // 계산 불가면 빈 문자열
    key: string;
    // 계산 불가면 null. 파일 이름 칸에 `*`가 남아 있을 수 있다.
    path: string | null;
    // 마지막 멤버의 path. 멤버가 없으면 null
    from: string | null;
    // path가 있고 `*`가 없으면 true
    complete: boolean;
    // 계산한 key를 가진 멤버가 이미 있다
    taken: boolean;
  };
};

// I58e가 채운다. harness/tools의 `BUILTIN_TOOLS`가 더하고 역할 상한 이름 표가 Operator와 lophn에게 연다.
export const SERIES_NEXT_TOOLS: readonly ToolDefinition[] = [];

export function createSeriesNextToolHandlers(
  _ports: ContractCall,
): ReadonlyMap<string, ToolHandler> {
  throw new Error("not implemented");
}
