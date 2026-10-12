import type { PreparedFile } from "../../contracts/lophn-agent/mod.ts";
import type { FileStat, JudgedFile } from "./judge.ts";
import type { RewindStore } from "./store.ts";

// 문서 파일 복원의 transaction 밖 준비와 설치다(lophn-agent/revert "복원 쓰기", R17). 구현은
// agent-RW3b가 채운다. 순서는 observeFiles → prepareRestore → (Rewind command) → installRestore다.
// root는 project 폴더의 절대 경로이고 path는 그 기준 상대 경로다.

// 경로마다 지금 상태를 본다. symlink(lstat)이거나 hard link(nlink > 1)면 link=true다. 없는 경로는
// exists=false다. 내용은 sha256(hex)이다.
export function observeFiles(
  root: string,
  paths: readonly string[],
): Map<string, FileStat> {
  void root;
  void paths;
  throw new Error("not implemented: agent-RW3b");
}

// 판정에 든 경로마다 PreparedFile 하나를 만든다(복원·건너뜀·이름 변경의 옛 경로 모두).
//   observed_sha256·link: current의 관측.
//   staged: plan=restore이고 write 동작이면 pre-image를 저장소에서 읽을 수 있어 true, 그 밖에는 false.
//   redo_ref: keepRedo이고 plan=restore인 경로의 복원 직전 내용을 저장소에 두고 그 key를 싣는다.
//     지금 파일이 없으면 null이다.
export function prepareRestore(input: {
  root: string;
  store: RewindStore;
  session: string;
  judged: readonly JudgedFile[];
  current: ReadonlyMap<string, FileStat>;
  keepRedo: boolean;
}): Promise<PreparedFile[]> {
  void input;
  throw new Error("not implemented: agent-RW3b");
}

export type InstallResult = {
  path: string;
  result: "restored" | "skipped";
};

// Rewind command가 확정된 뒤 plan=restore인 경로를 복원한다. 경로마다 쓰기 직전에 지금 hash가
// prepared.observed_sha256과 같은지 다시 비교해 다르면 덮지 않고 skipped로 돌려준다. 같으면 임시
// 파일에 쓰고 hash를 확인해 원자 교체한다(없던 상위 폴더는 만든다). delete 동작은 파일을 지운다.
// 임시 파일은 남기지 않는다.
export function installRestore(input: {
  root: string;
  store: RewindStore;
  session: string;
  judged: readonly JudgedFile[];
  prepared: readonly PreparedFile[];
}): Promise<InstallResult[]> {
  void input;
  throw new Error("not implemented: agent-RW3b");
}

// Redo: 복원했던 파일을 되돌리기 전 내용으로 다시 쓴다. 경로의 지금 hash가 restored_sha256과 같은
// 것만 redo_ref의 내용으로 교체하고(redo_ref가 null이면 지운다) 아니면 건드리지 않고 skipped다.
export function installRedo(input: {
  root: string;
  store: RewindStore;
  session: string;
  entries: readonly {
    path: string;
    restored_sha256: string | null;
    redo_ref: string | null;
  }[];
}): Promise<InstallResult[]> {
  void input;
  throw new Error("not implemented: agent-RW3b");
}
