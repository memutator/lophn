// lophn_save tool의 실행이다(T14, mcp#R13–R15). 입력은 registry가 소유 route 입력으로
// 검사했다: 폐지 소속·원본 파일 이동 같은 모르는 필드는 strict 입력에서 거절돼 여기까지
// 오지 않는다. 흐름(자리·series 검사 → 준비 → 저장 → 가입)은 CLI와 같은 통로를 쓴다.
import type { Route } from "../../../contracts/platform/mod.ts";
import {
  describeSave,
  describeSaveFailure,
  type FlowClient,
  saveDocument,
  type SaveInput,
} from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type SaveToolDeps = { client: FlowClient };

export function createSaveTool(
  deps: SaveToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  return async function runSaveTool(_toolName, _route, rawInput) {
    const saved = await saveDocument(deps.client, rawInput as SaveInput);
    if (!saved.ok) {
      return { ...describeSaveFailure(saved.error), isError: true };
    }
    return describeSave(saved.value);
  };
}
