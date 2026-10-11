import { bundleContentSchema } from "../../../contracts/documents/mod.ts";
import type { CheckFinding } from "../../../contracts/documents/mod.ts";
import { checkEntities } from "../checks/run.ts";
import type { CheckEntity } from "../checks/types.ts";
import { extractAll } from "../extract/run.ts";
import { validateBundle } from "../validate/mod.ts";
import { exampleFindings, savedViewFindings } from "./runner-examples.ts";
import { meaningFindings, schemaFindings } from "./runner-findings.ts";
import { snapshotHash } from "./snapshot.ts";
import type { CheckInput, CheckOutcome, CheckViolation } from "./types.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function outcome(
  snapshot_hash: string,
  findings: CheckFinding[],
  violations: CheckViolation[],
): CheckOutcome {
  return {
    status: findings.length === 0 ? "passed" : "failed",
    snapshot_hash,
    findings,
    violation_count: violations.length,
    violations,
  };
}

// 판 하나를 snapshot에 대해 검사한다. 단계와 finding은 types.ts에 있다.
// 순수하다: 같은 snapshot과 같은 판이면 결과가 byte까지 같다.
export function runCheck(input: CheckInput): CheckOutcome {
  let hash: string;
  try {
    hash = snapshotHash(input.files);
  } catch (error) {
    return outcome("", [aborted(error)], []);
  }
  try {
    return run(input, hash);
  } catch (error) {
    return outcome(hash, [aborted(error)], []);
  }
}

function aborted(error: unknown): CheckFinding {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "aborted",
    target: null,
    detail: message.trim() === "" ? "aborted" : message,
  };
}

function run(input: CheckInput, hash: string): CheckOutcome {
  const parsed = bundleContentSchema.safeParse(input.bundle);
  if (!parsed.success) {
    return outcome(hash, schemaFindings(parsed.error.issues), []);
  }
  const bundle = parsed.data;

  const issues = validateBundle(bundle, input.env);
  if (issues.length > 0) return outcome(hash, meaningFindings(issues), []);

  const extracted = extractAll(bundle, input.files, input.appData);
  const ruleViolations = checkEntities(
    bundle.contract,
    extracted.entities as CheckEntity[],
    () => undefined,
  );
  const violations: CheckViolation[] = [
    ...extracted.violations,
    ...ruleViolations,
  ].sort((a, b) =>
    compare(a.path, b.path) || compare(a.kind, b.kind) ||
    compare(a.rule ?? "", b.rule ?? "") ||
    compare(a.section ?? "", b.section ?? "")
  );

  const findings = [
    ...exampleFindings(bundle, extracted.entities),
    ...savedViewFindings(
      bundle,
      [...bundle.saved_views, ...input.user_saved_views],
      extracted.entities,
    ),
  ];
  return outcome(hash, findings, violations);
}
