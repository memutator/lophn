// lophn_save tool의 실행이다(T14, mcp#R13–R15). 입력은 registry가 tool 입력으로
// 검사했다: 폐지 소속·원본 파일 이동·옛 저장 종류 같은 모르는 필드는 strict 입력에서
// 거절돼 여기까지 오지 않는다. 파일은 제출 root 기준 상대 경로이고 tool이 realpath로
// 다시 검사한 뒤 bytes를 core로 보낸다(connection#R10). 흐름은 CLI와 같은 통로다.
import type { Route } from "../../../protocol/server/mod.ts";
import {
  describeSave,
  describeSaveFailure,
  type PathSaveDeps,
  saveFromPaths,
  type SaveInput,
} from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type SaveToolDeps = PathSaveDeps;

export function createSaveTool(
  deps: SaveToolDeps,
): (toolName: string, route: Route, input: unknown) => Promise<ToolOutput> {
  return async function runSaveTool(_toolName, _route, rawInput) {
    const saved = await saveFromPaths(
      deps,
      rawInput as Omit<SaveInput, "files"> & { paths: string[] },
    );
    if (!saved.ok) {
      return { ...describeSaveFailure(saved.error), isError: true };
    }
    return describeSave(saved.value);
  };
}
