// reader Worker가 팀 등록 file로 import한다. GetInstructions·PreviewGlobalInstructions의 reader 서빙에 project·앱 조회와
// role 규칙을 꽂는다. 동기 file API는 lophn-agent/instructions/files.ts 안에서 handler가 불릴 때만 쓴다.
import {
  agentFilePathOf,
  mayReadOtherProject,
} from "../../../agent-roles/place/instruction-rules.ts";
import { appSourcePath } from "../../../apps/lookups.ts";
import { createInstructionReads } from "../../../lophn-agent/instructions/files.ts";
import {
  innermostProjectOfPath,
  projectExists,
  projectFolderPaths,
} from "../../../projects/lookups.ts";
import type { ReaderRegistration } from "../../../storage/ledger/mod.ts";

export function createReaderRegistration(): ReaderRegistration {
  return createInstructionReads({
    projectExists,
    projectFirstFolder: (sql, project) =>
      projectFolderPaths(sql, project)[0] ?? null,
    projectOfApp(sql, app) {
      const source = appSourcePath(sql, app);
      return source === null ? null : innermostProjectOfPath(sql, source);
    },
    agentFilePathOf,
    mayReadOtherProject,
  });
}
