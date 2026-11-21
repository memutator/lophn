// GUI 탭의 CLI가 `lophn`을 부를 turn 자격 file. CLI는 오래 살아 env가 띄울 때 정해지므로 env에는 이 경로만 두고(secret이 아니다),
// core가 turn이 열릴 때 그 turn의 자격을 쓰고 끝나면 지운다. 자격의 규칙(그 session·그 turn에만, turn 끝에 끝남)은 그대로다.
// 탭(터미널)마다 file 하나이고 per-run 폴더 안 0700 폴더에 0600으로 둔다. core가 끝나면 per-run 폴더와 함께 사라진다.
import { join } from "node:path";

export type CredentialFiles = {
  /** 그 탭의 CLI env에 넣을 경로. */
  pathOf(terminalRef: string): string;
  write(terminalRef: string, token: string): void;
  remove(terminalRef: string): void;
};

export function createCredentialFiles(deps: {
  root: string;
  fs: {
    mkdir(path: string, mode: number): void;
    write(path: string, text: string, mode: number): void;
    // 없으면 아무것도 하지 않는다.
    remove(path: string): void;
  };
}): CredentialFiles {
  // terminal ref(`trm_<ULID>`)는 core가 만든 id라 그대로 file 이름이다.
  const pathOf = (terminalRef: string) => join(deps.root, terminalRef);
  return {
    pathOf,
    write(terminalRef, token) {
      deps.fs.mkdir(deps.root, 0o700);
      deps.fs.write(pathOf(terminalRef), token, 0o600);
    },
    remove(terminalRef) {
      deps.fs.remove(pathOf(terminalRef));
    },
  };
}
