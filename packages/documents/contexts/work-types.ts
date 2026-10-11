// context worker의 일(`context.index`, `context.check`)이 쓰는 port. 파일 시스템과 core 제출은
// 모두 주입받는다(docs/architecture/documents.md 2.4). 일은 핵심 계산을 index/·check/ 같은 순수
// 폴더에 맡기고 여기서는 순서만 정한다.
import type { Result } from "../../base/mod.ts";
import type { z } from "zod";
import type {
  bundleFinishCheckRequestSchema,
  violationsRecordRequestSchema,
} from "../../contracts/documents/mod.ts";
import type { ProjectFiles } from "./extract/types.ts";
import type { WatchFolder } from "./watch/mod.ts";

export type FinishCheckInput = z.input<typeof bundleFinishCheckRequestSchema>;
export type RecordViolationsInput = z.input<
  typeof violationsRecordRequestSchema
>;

// core에 좁은 machine 자격으로 내는 두 command. worker는 `lophn.db`를 열지 않는다.
// 오류는 core가 돌려준 공통 오류 code 그대로다.
export type SubmitPort = {
  // `bundle.finish_check`
  finishCheck(input: FinishCheckInput): Promise<Result<unknown>>;
  // `context.record_violations`
  recordViolations(input: RecordViolationsInput): Promise<Result<unknown>>;
};

// 계약 폴더의 파일을 임시 폴더로 복사해 고정한 snapshot.
export type Snapshot = {
  files: ProjectFiles;
  // 임시 폴더를 지운다. 두 번 불러도 된다.
  remove(): void;
};

export type SnapshotPort = {
  // folders 아래 파일만 `staging/context-check/<check>/`로 복사한다. 복사하지 못하면 `unavailable`.
  // roots는 Project 폴더의 절대 경로다(앞 폴더가 이긴다). 어댑터가 따로 알면 비워도 된다.
  create(
    check: string,
    folders: readonly WatchFolder[],
    roots?: readonly string[],
  ): Result<Snapshot>;
};
