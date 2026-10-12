import type {
  FileState,
  RevertReason,
} from "../../contracts/lophn-agent/mod.ts";

// 문서 파일 복원 판정(lophn-agent/revert "판정 규칙"). 기록(RewindFile)과 파일의 지금 상태만 받는 순수
// 함수다. 구현은 agent-RW3b가 채운다.

export type JudgeRecord = {
  tool_call: string;
  path: string;
  seq: string;
  before: FileState;
  after: { exists: boolean; sha256: string | null };
  moved_from: string | null;
  reverted_by: string | null;
};

// 파일의 지금 상태. link는 symlink이거나 hard link인 경로다.
export type FileStat = {
  exists: boolean;
  sha256: string | null;
  link: boolean;
};

export type FileAction =
  | { kind: "write"; path: string; sha256: string; blob: string }
  | { kind: "delete"; path: string };

export type JudgedFile = {
  // 판정 단위의 경로(마지막 기록의 path)다. 이름 변경이면 새 경로다.
  path: string;
  // 이 경로를 쓴 tool call. 되돌림에서 빠진(reverted_by) 기록은 들지 않고 seq 순서다.
  source: string[];
  plan: "restore" | "skip";
  reason: RevertReason | null;
  // plan=restore일 때만 있다. 첫 기록의 before로 교체하거나(write) 지운다(delete).
  actions: FileAction[];
  // 복원한 뒤 이 경로의 내용 hash. 사라지면 null. Redo가 "지금 hash == 복원한 내용"을 비교한다.
  restored_sha256: string | null;
};

// 경로마다 `reverted_by`가 없는 기록을 seq 순서로 모아 사슬을 확인한다. 이유 코드는 이 순서로 정한다.
//   1. 기록이 모두 되돌려졌으면 skip `already_reverted`.
//   2. 지금 경로가 symlink·hard link면 skip `link_path`.
//   3. 사슬의 어느 기록이든 before가 있었는데 pre-image(blob)가 없으면 skip `no_pre_image`.
//   4. 앞 기록의 after와 뒤 기록의 before가 다르면 skip `chain_broken`.
//   5. 지금 hash가 마지막 after와 다르면: 첫 before가 없었던 파일(agent가 만든 파일)이고 지금
//      파일이 있으면 skip `created_edited`, 아니면 skip `edited_outside`. 지금 파일이 없고 마지막
//      after.exists면 복원한다(되살림).
//   6. 이름 변경이면 옛 경로(moved_from)에 이미 파일이 있을 때 skip `rename_blocked`.
//   7. 아니면 restore: 첫 before가 있었으면 write, 없었으면 delete. 이름 변경은 옛 경로에 write하고
//      새 경로를 delete한다.
// 결과는 첫 기록의 seq 오름차순이다. current에 없는 경로는 파일이 없는 것으로 본다.
export function judgeFiles(input: {
  records: readonly JudgeRecord[];
  current: ReadonlyMap<string, FileStat>;
}): JudgedFile[] {
  void input;
  throw new Error("not implemented: agent-RW3b");
}
