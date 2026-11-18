// 다른 컴퓨터의 명단 file `machines/<mch>/roster.json`을 읽어 statement만 명단에 넘긴다. `computers` 폴더(받는 자리가 둔
// 것)와 사람의 폴더(manifest 없이도: 아직 믿지 못하는 컴퓨터의 들어오기 statement가 이 길로 온다) 둘 다 읽는다. 믿는
// 서명이 없는 statement는 명단 규칙이 스스로 거른다. 주소는 폴더로 받지 않는다. 지난번과 같은 bytes는 다시 넘기지 않는다.
import { type Result, sha256Hex } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  ROSTER_FILE_MAX_BYTES,
  rosterFilePath,
  rosterFileSchema,
} from "../../../protocol/folder/carry.ts";
import { decodeRecord } from "../../../protocol/folder/records.ts";
import type { RosterStatement } from "../../../protocol/remote/roster.ts";
import { createFolderReader } from "../fs.ts";

export type RosterFiles = {
  /** `root`(폴더) 아래 다른 기계의 명단 file을 모두 읽는다. `source`는 지난번 bytes를 가르는 이름이다. */
  readFrom(root: string, source: string): Promise<void>;
};

export function createRosterFiles(deps: {
  me(): Id<"mch">;
  receive(statements: readonly RosterStatement[]): Promise<Result<void>>;
  log(message: string): void;
}): RosterFiles {
  const last = new Map<string, string>();
  return {
    async readFrom(root, source) {
      const reader = createFolderReader(root);
      const machines = await reader.listMachines();
      if (!machines.ok) return;
      for (const machine of machines.value) {
        if (machine === deps.me()) continue;
        const path = rosterFilePath(machine);
        const read = await reader.read(path, ROSTER_FILE_MAX_BYTES);
        if (!read.ok) continue;
        const key = `${source}\n${machine}`;
        const hash = await sha256Hex(read.value);
        if (last.get(key) === hash) continue;
        const file = decodeRecord(
          rosterFileSchema,
          read.value,
          ROSTER_FILE_MAX_BYTES,
        );
        if (!file.ok || file.value.machine !== machine) {
          deps.log(`${source} ${path}: not a roster file of that machine`);
          last.set(key, hash);
          continue;
        }
        const done = await deps.receive(file.value.statements);
        if (done.ok) last.set(key, hash);
        else deps.log(`${source} ${path}: ${done.error.message}`);
      }
    },
  };
}
