import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";

// projects가 바깥에서 받는 것들이다. 구현은 main/daemon/wiring이 끼운다.

// project를 등록하는 command가 같은 tx 안에서 그 project의 Project Manager를 만들어 둔다.
export interface ProjectManagerProvisioning {
  create(tx: Tx, project: string): Result<void>;
}

// 하위 폴더가 연결 폴더 밖으로 나가지 않는지 realpath로 검사한다. 순수 함수가 못하므로 port다.
export interface FolderResolver {
  resolveInside(folderPath: string, subfolder: string): Result<string>;
  exists(folderPath: string): boolean;
}
