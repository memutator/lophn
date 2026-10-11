import type { Result } from "../../../base/mod.ts";
import type { IndexStore } from "./store.ts";
import type { ScanInput, ScanResult } from "./types.ts";

// context 하나의 index를 계약 경로의 stat으로 갱신한다(documents/contexts#R23).
//
// 1. 훑을 파일 = files.paths() 중 watchFolders(bundle.contract)가 덮는 것. 폴더 밖 파일은 stat도 하지 않고
//    index에 넣지 않는다. 훑는 중 files가 throw하면 `unavailable`을 돌려주고 store를 건드리지 않는다.
// 2. changed = index_files에 없거나 (size, mtime_ms)가 다른 파일. index_state의 bundle_hash가 입력 판과 다르거나
//    state가 없으면 훑은 파일 전부. removed = index_files에 있으나 훑은 목록에 없는 파일.
// 3. changed나 removed가 없으면 글을 읽지 않고 index_files·index_entities·index_violations에 쓰지 않는다.
//    index_state의 scanned_at만 clock.now()로 갱신한다.
// 4. 있으면 계약 전체를 훑은 파일 위에서 다시 추출·검사한다(`extractAll` + `checkEntities`, app-data는
//    읽지 않으므로 그 type의 개체는 저장하지 않는다). series의 path_mismatch, folder의 하위 폴더, 링크 대상 같은
//    관계가 파일 하나로 정해지지 않아서 개체와 위반은 통째로 바꾸고, 같은 transaction에서 index_files를
//    새 stat·판·상태(unreadable 위반이 있는 파일은 failed)로 맞추고 index_state를 complete로 쓴다.
// 5. rose = violation_count > recorded_count. 저장된 index가 ledger보다 앞서 있어도(응답 유실, store 재생성)
//    다음 scan이 다시 true를 내므로 제출이 재시도된다.
export function scanContext(
  _store: IndexStore,
  _input: ScanInput,
): Result<ScanResult> {
  throw new Error("not implemented");
}
