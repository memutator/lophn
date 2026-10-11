import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import type { BundleContent } from "../../contracts/documents/mod.ts";
import {
  type IndexFiles,
  type IndexStore,
  scanContext,
  type ScanResult,
} from "./index/mod.ts";
import type { SubmitPort } from "./work-types.ts";
import { type WatchFolder, watchFolders } from "./watch/mod.ts";

export type IndexJobRequest = {
  context: string;
  // 적용 판. core가 blob을 읽어 싣는다.
  bundle: BundleContent;
  bundle_hash: string;
  // ledger가 마지막으로 기록한 위반 수(contexts.violation_mark)
  recorded_count: number;
};

export type IndexJobDeps = {
  store: IndexStore;
  // 계약 폴더 아래 Project 파일의 보기. 폴더 밖은 담지 않는다.
  files(folders: readonly WatchFolder[]): IndexFiles;
  clock: Clock;
  submit: Pick<SubmitPort, "recordViolations">;
};

export type IndexJobResult = ScanResult & {
  // context.record_violations를 냈고 받아들여졌는가
  recorded: boolean;
};

// context.index: watchFolders(bundle.contract)로 files를 얻어 scanContext를 돌린다.
// 위반 수(violation_count)가 recorded_count와 다르면 늘었든 줄었든
// `context.record_violations({ context, count: violation_count, bundle_hash })`를 한 번 제출한다.
// 같으면 제출하지 않는다. notification은 늘었을 때만 만들어지며 그 판단은 platform 쪽이다.
// - files나 scan이 실패하면 그 오류(`unavailable`)를 돌려주고 제출하지 않는다.
// - 제출이 오류를 내면 그 오류를 그대로 돌려준다. index는 이미 갱신되어 있고, 다음 job은 ledger의
//   recorded_count와 비교하므로 같은 제출을 다시 시도한다. 오류를 삼켜 recorded를 꾸미지 않는다.
export async function runIndexJob(
  deps: IndexJobDeps,
  request: IndexJobRequest,
): Promise<Result<IndexJobResult>> {
  let files: IndexFiles;
  try {
    files = deps.files(watchFolders(request.bundle.contract));
  } catch (error) {
    return err({
      code: "unavailable",
      message: `project files cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  const scanned = scanContext(deps.store, {
    context: request.context,
    bundle: request.bundle,
    bundle_hash: request.bundle_hash,
    files,
    clock: deps.clock,
    recorded_count: request.recorded_count,
  });
  if (!scanned.ok) return scanned;
  if (scanned.value.violation_count === request.recorded_count) {
    return ok({ ...scanned.value, recorded: false });
  }
  const submitted = await deps.submit.recordViolations({
    context: request.context,
    count: scanned.value.violation_count,
    bundle_hash: request.bundle_hash,
  });
  if (!submitted.ok) return submitted;
  return ok({ ...scanned.value, recorded: true });
}
