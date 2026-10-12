// save command다. 위치 인자 파일 묶음의 첫 파일이 primary이고
// 정본 저장만 한다: 자리 놓기·원본 제거·보관 복귀 command는 없다. 파일은
// submission root 안에서 realpath로 다시 검사한 뒤 bytes만 core의
// blob 준비로 넘기고, 준비·저장은 MCP `lophn_save`와 같은 통로를 쓴다.
import type { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import { cliSaveSchema } from "../../../protocol/coding-agent/mod.ts";
import {
  documentList,
  documentPrepare,
  documentSave,
  seriesAddInstance,
  seriesGet,
} from "../../../protocol/projects/mod.ts";
import {
  describeSave,
  type PathSaveDeps,
  saveFromPaths,
  type SaveReport,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

export const SAVE_COMMANDS: readonly CommandEntry[] = [
  {
    name: "save",
    input: cliSaveSchema,
    // save가 이어 부르는 소유 route들이다. 임의 core API는 부르지 않는다.
    opRoutes: {
      list: documentList,
      series: seriesGet,
      prepare: documentPrepare,
      save: documentSave,
      join: seriesAddInstance,
    },
  },
];

export type SaveRunDeps = PathSaveDeps;

export type SaveCommandInput = z.infer<typeof cliSaveSchema>;

// 검사한 입력으로 저장한다. 실패는 단계의 오류 그대로이고 부분 성공은 details.saved에
// 저장된 고정 주소를 남긴다.
export async function runSave(
  input: SaveCommandInput,
  deps: SaveRunDeps,
): Promise<Result<SaveReport, LophnError>> {
  const saved = await saveFromPaths(deps, {
    paths: input.paths,
    ...(input.place === undefined ? {} : { place: input.place }),
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(input.series === undefined ? {} : { series: input.series }),
    ...(input.key === undefined ? {} : { key: input.key }),
    ...(input.base_revision === undefined
      ? {}
      : { base_revision: input.base_revision }),
    ...(input.idempotency_key === undefined
      ? {}
      : { idempotency_key: input.idempotency_key }),
  });
  if (!saved.ok) return err(saved.error);
  return ok(describeSave(saved.value));
}
