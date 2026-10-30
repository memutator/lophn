// reader Worker가 팀 등록 file로 import한다. GetInstructions의 reader 서빙에 project 폴더 조회와
// place 종류 규칙을 꽂는다. 동기 file API는 lophn-agent/instructions/files.ts 안에서 handler가 불릴 때만 쓴다.
import { placeDataFolder } from "../../../agent-places/place/data-folder.ts";
import {
  agentFilePathOf,
  mayReadDomain,
} from "../../../agent-places/place/instruction-rules.ts";
import { domainOwnerOf } from "../../../domains/lookups.ts";
import { createInstructionReads } from "../../../lophn-agent/instructions/files.ts";
import { projectFolderPaths } from "../../../projects/lookups.ts";
import type { ReaderRegistration } from "../../../storage/ledger/mod.ts";

export function createReaderRegistration(): ReaderRegistration {
  return createInstructionReads({
    projectFirstFolder: (sql, project) =>
      projectFolderPaths(sql, project)[0] ?? null,
    projectDataFolder: (root, project) =>
      placeDataFolder(root, { kind: "project", id: project }),
    agentFilePathOf,
    domainOwnerOf,
    mayReadDomain,
  });
}
