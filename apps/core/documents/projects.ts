import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { DocumentRef } from "../../../packages/contracts/documents/mod.ts";
import type { RequestContext } from "../../../packages/contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../../packages/documents/addressing/mod.ts";
import type { ProjectAuthorizer } from "../../../packages/documents/projects/authorization.ts";
import { createProjectCommands } from "../../../packages/documents/projects/commands.ts";
import {
  createProjectReads,
  type ProjectReadDeps,
} from "../../../packages/documents/projects/reads.ts";
import { projectsSchemaSteps } from "../../../packages/documents/projects/schema.ts";
type LedgerTestEnvironment = {
  currentCredential(credentialRef: string): Result<RequestContext>;
};
type LedgerTestRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
};

// 현재 credential의 operation 목록만 대조한다. owner target 검사는 public seam이 없다(Q13).
function currentAuthorizer(
  environment: LedgerTestEnvironment,
): ProjectAuthorizer {
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
    return allows(current.value, operation);
  };
}

function allows(ctx: RequestContext, operation: string): Result<void> {
  return ctx.scope.operations.includes(operation)
    ? ok(undefined)
    : err({ code: "forbidden", message: "operation forbidden" });
}

// 문서 목록은 versions concern의 read다. seam이 없어 빈 목록만 준다.
function emptyDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

export function createLedgerTestRegistration(
  environment: LedgerTestEnvironment,
): LedgerTestRegistration {
  const authorizeProject = currentAuthorizer(environment);
  const commands = createProjectCommands({ authorize: authorizeProject });
  const deps: ProjectReadDeps = {
    authorize: authorizeProject,
    documents: emptyDocuments,
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
    reads: [reads.list, reads.get, reads.resolve],
  };
}
