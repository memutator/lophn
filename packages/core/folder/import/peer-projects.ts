// 다른 기계가 기계 기록에 실은 git project 목록(architecture `project-identity` "자동 match"). `computers` 폴더의 사본만
// 읽는다: 그 file은 받는 자리가 그 기계가 서명한 목록에 맞을 때만 쓴다. 이름 붙인 폴더의 기록은 서명이 없어 그 폴더를 쓸 수
// 있는 누구나 만들 수 있고, `folder_records`는 destination을 건너 가장 큰 revision 하나를 두므로 거기서 고르면 그런 기록이
// project의 id를 옮길 수 있다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Id } from "../../../protocol/base/ids.ts";
import {
  decodeRecord,
  isMachineDirName,
  MACHINES_DIR,
  machineRecordSchema,
  RECORD_MAX_BYTES,
  recordPath,
  type SharedProject,
} from "../../../protocol/folder/mod.ts";

// trusted는 지금 명단에서 그 기계의 서명 key를 믿는가다(빼기나 key 다툼에 걸린 기계의 남은 사본은 쓰지 않는다).
export function peerProjects(
  computersRoot: string,
  me: Id<"mch">,
  trusted: (machine: Id<"mch">) => boolean,
): { machine: Id<"mch">; projects: SharedProject[] }[] {
  let names: string[];
  try {
    names = readdirSync(join(computersRoot, MACHINES_DIR));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!isMachineDirName(name) || name === me || !trusted(name)) return [];
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(computersRoot, recordPath(name)));
    } catch {
      return [];
    }
    const record = decodeRecord(machineRecordSchema, bytes, RECORD_MAX_BYTES);
    if (!record.ok || record.value.machine !== name) return [];
    return [{ machine: name, projects: record.value.projects }];
  });
}
