import { ok, type Result } from "../../packages/base/mod.ts";
import type { DocumentRef } from "../../packages/contracts/documents/mod.ts";
import { addressingSchemaSteps } from "../../packages/documents/addressing/mod.ts";
import { createProjectCommands } from "../../packages/documents/projects/commands.ts";
import {
  createProjectReads,
  type ProjectReadDeps,
} from "../../packages/documents/projects/reads.ts";
import { projectsSchemaSteps } from "../../packages/documents/projects/schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
};

// 문서 목록은 versions concern의 read다. seam이 없어 빈 목록만 준다.
function emptyDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const deps: ProjectReadDeps = {
    documents: emptyDocuments,
  };
  const reads = createProjectReads(deps);
  return {
    schemaSteps: [...addressingSchemaSteps, ...projectsSchemaSteps],
    commands: [
      commands.create,
      commands.update,
      commands.setTracking,
      commands.archive,
      commands.unarchive,
    ],
    reads: [
      reads.list,
      reads.get,
      reads.resolve,
      reads.resolveCwd,
      reads.trackingRoots,
    ],
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
