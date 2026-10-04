import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { DocumentRef } from "../../packages/contracts/documents/mod.ts";
import type { RequestContext } from "../../packages/contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../packages/documents/addressing/mod.ts";
import type { ProjectAuthorizer } from "../../packages/documents/projects/authorization.ts";
import { createProjectCommands } from "../../packages/documents/projects/commands.ts";
import {
  createProjectReads,
  type ProjectReadDeps,
} from "../../packages/documents/projects/reads.ts";
import { projectsSchemaSteps } from "../../packages/documents/projects/schema.ts";

type LedgerEnvironment = {
  currentCredential(credentialRef: string): Result<RequestContext>;
};
type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
};

// host가 고정한 authenticated current cwd. credential schema에는 cwd가 없어
// credential_ref에 실어 reader Worker까지 전달한다. 접두가 없으면 근거가 없다.
export const AUTHENTICATED_CWD_PREFIX = "cwd:";

export function authenticatedCwdRef(
  credentialRef: string,
  cwd: string,
): string {
  return `${credentialRef}\n${AUTHENTICATED_CWD_PREFIX}${
    encodeURIComponent(cwd)
  }`;
}

function fixedCwd(credentialRef: string): string | null {
  const line = credentialRef.split("\n").find((part) =>
    part.startsWith(AUTHENTICATED_CWD_PREFIX)
  );
  if (line === undefined) return null;
  return decodeURIComponent(line.slice(AUTHENTICATED_CWD_PREFIX.length));
}

// 현재 credential의 operation 목록만 대조한다. owner target 검사는 public seam이 없다(Q13).
function currentAuthorizer(environment: LedgerEnvironment): ProjectAuthorizer {
  return (ctx, operation) => {
    const current = environment.currentCredential(ctx.credential_ref);
    if (!current.ok) return current;
    if (
      current.value.principal !== ctx.principal ||
      current.value.actor !== ctx.actor
    ) {
      return err({
        code: "forbidden",
        message: "현재 credential binding이 다르다",
      });
    }
    return ctx.scope.operations.includes(operation)
      ? ok(undefined)
      : err({ code: "forbidden", message: "operation forbidden" });
  };
}

// 문서 목록은 versions concern의 read다. seam이 없어 빈 목록만 준다.
function emptyDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

export function createLedgerRegistration(
  environment: LedgerEnvironment,
): LedgerRegistration {
  const authorize = currentAuthorizer(environment);
  const commands = createProjectCommands({ authorize });
  const deps: ProjectReadDeps = {
    authorize,
    documents: emptyDocuments,
    currentCwd(ctx) {
      return ok(fixedCwd(ctx.credential_ref));
    },
  };
  const reads = createProjectReads(deps);
  return {
    schemaSteps: [...addressingSchemaSteps, ...projectsSchemaSteps],
    commands: [
      commands.create,
      commands.update,
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
  environment: LedgerEnvironment,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
