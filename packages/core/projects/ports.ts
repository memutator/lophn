import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";

// projects가 바깥에서 받는 것들이다. 구현은 main/daemon/wiring이 끼운다.

// project를 등록하는 command가 같은 tx 안에서 그 project의 Project Manager를 만들어 둔다.
export interface ProjectManagerProvisioning {
  create(tx: Tx, project: string): Result<void>;
}

// context를 만들고 고치고 판을 올릴 수 있는 쪽을 판정한다. 그 project의 Project Manager이거나 사람이다.
// actor 문자열 모양은 protocol/base/actor.ts를 따른다.
export interface ContextAuthority {
  canWrite(actor: string, project: string): boolean;
}

// 초안 폴더가 놓이는 lophn data 아래 위치. 파일 IO는 구현이 한다.
export interface ContextFolders {
  draftFolder(project: string, context: string, bundle: string): string;
}

// 하위 폴더가 연결 폴더 밖으로 나가지 않는지 realpath로 검사한다. 순수 함수가 못하므로 port다.
export interface FolderResolver {
  resolveInside(folderPath: string, subfolder: string): Result<string>;
  exists(folderPath: string): boolean;
}
