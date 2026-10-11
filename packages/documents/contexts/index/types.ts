// context index(derived store)의 모양. 표의 뜻은 docs/architecture/documents.md 3.2,
// 훑기 규칙은 documents/contexts#R23이다.
import type { Clock } from "../../../base/mod.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import type { ExtractedEntity, ProjectFiles } from "../extract/types.ts";

export type FileStat = {
  size: number;
  // 수정 시각(ms, 정수)
  mtime_ms: number;
};

// 훑을 Project 파일의 보기. ProjectFiles에 stat이 더해진다. 어댑터가 계약 폴더(watchFolders)
// 아래 파일만 담아 주지만, 훑기도 폴더 밖 경로는 다시 걸러 낸다.
export type IndexFiles = ProjectFiles & {
  // 없는 파일은 null. 글을 읽지 않는다.
  stat(path: string): FileStat | null;
};

export type IndexedFile = FileStat & {
  path: string;
  // 이 행을 만든 extract가 쓴 판
  bundle_hash: string;
  // 그 파일이 개체로 읽히지 않으면(unreadable 위반) failed, reason은 위반 kind
  status: "ok" | "failed";
  reason: string | null;
};

export type IndexedEntity = ExtractedEntity & {
  // 그 type의 source kind(`series`, `docs`, …). app-data 개체는 저장하지 않는다.
  source_kind: string;
};

export type IndexState = {
  bundle_hash: string;
  // 마지막 scan이 끝난 시각(clock.now())
  scanned_at: string;
  result: "complete" | "partial" | "failed";
};

export type ScanInput = {
  context: string;
  // 적용 판. core가 blob을 읽어 요청에 싣는다.
  bundle: BundleContent;
  bundle_hash: string;
  files: IndexFiles;
  clock: Clock;
  // ledger가 마지막으로 기록한 위반 수(contexts.violation_mark). `rose`는 이것과 비교하고, 제출 여부는 job이 이것과의 같고 다름으로 정한다.
  recorded_count: number;
};

export type ScanResult = {
  // 훑은(계약 폴더 안) 파일 수
  scanned: number;
  // 새로 생겼거나 (size, mtime)이 달라진 파일. 판이 바뀌었으면 훑은 파일 전부. code unit 순.
  changed: string[];
  // index에 있었으나 사라진 파일
  removed: string[];
  // changed나 removed가 있어 개체와 위반을 다시 계산했는가
  extracted: boolean;
  // index에 있는 위반의 수(다시 계산하지 않았으면 저장된 것)
  violation_count: number;
  // violation_count > recorded_count
  rose: boolean;
};
