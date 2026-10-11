import type { Clock, Result } from "../../base/mod.ts";
import type { BundleContent } from "../../contracts/documents/mod.ts";
import type { IndexFiles, IndexStore, ScanResult } from "./index/mod.ts";
import type { SubmitPort } from "./work-types.ts";
import type { WatchFolder } from "./watch/mod.ts";

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
// scan이 rose를 내면 `context.record_violations({ context, count: violation_count, bundle_hash })`를
// 한 번 제출한다. rose가 아니면 제출하지 않는다(위반이 줄거나 그대로면 기록하지 않는다).
// - files나 scan이 실패하면 그 오류(`unavailable`)를 돌려주고 제출하지 않는다.
// - 제출이 오류를 내면 그 오류를 그대로 돌려준다. index는 이미 갱신되어 있고, 다음 job은 ledger의
//   recorded_count와 비교하므로 같은 제출을 다시 시도한다. 오류를 삼켜 recorded를 꾸미지 않는다.
export function runIndexJob(
  _deps: IndexJobDeps,
  _request: IndexJobRequest,
): Promise<Result<IndexJobResult>> {
  throw new Error("not implemented");
}
