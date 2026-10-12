import type { Clock } from "../../base/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  DiagnosticCheck,
  DiagnosticCheckResult,
  DiagnosticRecord,
} from "../../protocol/platform/mod.ts";
import { diagnosticsCheck } from "../../protocol/platform/mod.ts";
import type { ReadHandler } from "../server/mod.ts";
import { matchCredential, patternRevision } from "../../base/redaction/mod.ts";

// doctor가 실제로 검사하는 자료(platform/diagnostics#R9, R10). 원문 key·token·
// scope 밖 자료는 이 경계로 들어오지 않는다. 값은 소유 concern의 사실이고 doctor는
// 관측만 한다.

// 실행 자격 보관 파일의 관측 권한. mode는 파일의 권한 비트다.
export type CredentialPermissionObservation = {
  mode: number;
};

// grant 하나의 위험 관측. scope 원문은 받지 않는다. file과 network는 kind의
// 분류만 본다.
export type GrantRiskObservation = {
  app: string;
  kind: string;
  file: boolean;
  network: boolean;
  // 너무 넓은 grant로 소유 concern이 이미 판정한 사실.
  broad: boolean;
  // 마지막 사용 시각. 한 번도 쓰지 않았으면 null이다.
  last_used_at: string | null;
};

export type SdkHashObservation = {
  name: string;
  version: string;
  // bundle에 포함된 SDK 내용 hash와 설치된 같은 version의 내용 hash.
  bundle_hash: string;
  installed_hash: string;
};

export type DoctorObservation = {
  credentialPermission?: CredentialPermissionObservation;
  grants: readonly GrantRiskObservation[];
  sdk: readonly SdkHashObservation[];
  // 운영 log 줄. 미가공 key 패턴만 찾고 줄 원문은 결과에 남기지 않는다.
  logLines: readonly string[];
};

export type DoctorSource = {
  observe(): DoctorObservation;
};

// 오래 쓰지 않은 grant의 기준. 이 기간보다 오래 쓰이지 않으면 보고한다.
export const UNUSED_GRANT_MS = 90 * 24 * 60 * 60 * 1000;

const OWNER_ONLY = 0o700;

const CHECKS: readonly DiagnosticCheck[] = [
  "sdk_hash",
  "credential_permission",
  "broad_grant",
  "file_and_network_grant",
  "unused_grant",
  "raw_key_pattern",
];

function record(
  at: string,
  code: string,
  message: string,
  revision: string,
): DiagnosticRecord {
  return {
    at,
    component: "platform/diagnostics",
    kind: "health",
    code,
    error_type: null,
    location: null,
    message,
    redaction: {
      rule_revision: revision,
      status: "partial",
      content: null,
      redacted_items: [],
      omissions: [{
        location: "finding",
        reason: "private",
        message: "Only the registered classification is retained.",
      }],
    },
  };
}

function finding(
  check: DiagnosticCheck,
  at: string,
  code: string,
  message: string,
  revision: string,
): DiagnosticCheckResult {
  return {
    check,
    observed_at: at,
    finding: record(at, code, message, revision),
  };
}

function clear(
  check: DiagnosticCheck,
  at: string,
): DiagnosticCheckResult {
  return { check, observed_at: at, finding: null };
}

function selected(input: unknown): readonly DiagnosticCheck[] {
  const checks = input && typeof input === "object" && "checks" in input
    ? (input as { checks?: readonly DiagnosticCheck[] }).checks
    : undefined;
  return checks && checks.length > 0 ? checks : CHECKS;
}

function olderThan(at: string, now: string, span: number): boolean {
  const then = Date.parse(at);
  const current = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(current)) return false;
  return current - then > span;
}

// 검사 하나. 원문 key·token·scope 원문은 결과에 없다. 근거는 관측 사실의
// 분류와 시각뿐이다.
function runCheck(
  check: DiagnosticCheck,
  observation: DoctorObservation,
  at: string,
  revision: string,
): DiagnosticCheckResult {
  if (check === "sdk_hash") {
    const mismatch = observation.sdk.find((sdk) =>
      sdk.bundle_hash !== sdk.installed_hash
    );
    return mismatch
      ? finding(
        check,
        at,
        "sdk_hash_mismatch",
        `SDK ${mismatch.name}@${mismatch.version} differs from the bundled copy.`,
        revision,
      )
      : clear(check, at);
  }
  if (check === "credential_permission") {
    const mode = observation.credentialPermission?.mode;
    return mode !== undefined && (mode & ~OWNER_ONLY) !== 0
      ? finding(
        check,
        at,
        "credential_permission",
        "Credential storage is readable beyond its owner.",
        revision,
      )
      : clear(check, at);
  }
  if (check === "broad_grant") {
    const broad = observation.grants.filter((grant) => grant.broad);
    return broad.length > 0
      ? finding(
        check,
        at,
        "broad_grant",
        `${broad.length} grant exceeds its narrow scope.`,
        revision,
      )
      : clear(check, at);
  }
  if (check === "file_and_network_grant") {
    const apps = new Set<string>();
    const file = new Set<string>();
    const network = new Set<string>();
    for (const grant of observation.grants) {
      if (grant.file) file.add(grant.app);
      if (grant.network) network.add(grant.app);
    }
    for (const app of file) if (network.has(app)) apps.add(app);
    return apps.size > 0
      ? finding(
        check,
        at,
        "file_and_network_grant",
        `${apps.size} app holds both file and network grants.`,
        revision,
      )
      : clear(check, at);
  }
  if (check === "unused_grant") {
    const unused = observation.grants.filter((grant) =>
      grant.last_used_at === null ||
      olderThan(grant.last_used_at, at, UNUSED_GRANT_MS)
    );
    return unused.length > 0
      ? finding(
        check,
        at,
        "unused_grant",
        `${unused.length} grant has not been used recently.`,
        revision,
      )
      : clear(check, at);
  }
  const matched = observation.logLines.some((line) =>
    matchCredential(line) !== undefined
  );
  return matched
    ? finding(
      check,
      at,
      "raw_key_pattern",
      "An unredacted key pattern remains in the operational log.",
      revision,
    )
    : clear(check, at);
}

// 인증은 API 입구가 이미 끝냈다. 무거운 검사는 worker가 하고 여기서는 그
// 관측만 읽는다(platform/diagnostics#R9, R10).
export function diagnosticsCheckRead(
  source: DoctorSource,
  clock: Clock,
): ReadHandler {
  return (
    _ctx: AuthenticatedContext,
    input: unknown,
  ): Result<unknown> => {
    const at = clock.now();
    const observation = source.observe();
    const results = selected(input).map((check) =>
      runCheck(check, observation, at, patternRevisionSync())
    );
    return ok({
      results,
      observed_at: at,
      as_of_seq: "0",
      next_cursor: null,
    });
  };
}

// patternRevision은 캐시한 hash를 돌려준다. 첫 호출 전에는 빈 revision으로
// 두지 않도록 worker가 검사 전에 데운다.
let cachedRevision = "";

function patternRevisionSync(): string {
  return cachedRevision;
}

export function warmPatternRevision(): Promise<string> {
  return patternRevision().then((revision) => {
    cachedRevision = revision;
    return revision;
  });
}

export const DIAGNOSTICS_CHECK_ROUTE = diagnosticsCheck;

// 저장 실패는 플랫폼 실패다. 성공 응답이나 앱 problem으로 바꾸지 않는다
// (platform/diagnostics#R4).
export function storageFailure(reason: "disk_full" | "ledger_corrupt"): Result<
  never
> {
  return err({
    code: "unavailable",
    message: reason === "disk_full"
      ? "저장 공간이 부족하다"
      : "ledger가 손상되었다",
    details: { reason },
  });
}

// 진단 상세는 redaction을 통과한 내용만 준다. 가공하지 못한 원문·stack은
// 제외하고 이유만 남긴다(platform/diagnostics#R5).
export function safeDetail(input: {
  message: string | null;
  redacted: boolean;
}): { message: string | null; omitted: boolean; reason: string | null } {
  if (input.redacted && input.message !== null) {
    return { message: input.message, omitted: false, reason: null };
  }
  return {
    message: null,
    omitted: true,
    reason: "redaction을 통과하지 못한 원문은 제공하지 않는다",
  };
}

// 보안 진단 분류. 원본은 소유 concern의 event이고 여기서는 분류만 구별한다
// (platform/diagnostics#R6).
export const SECURITY_DIAGNOSTIC_KINDS = [
  "permission_grant",
  "permission_revoke",
  "secret_use",
  "authentication_failure",
  "origin_rejected",
  "out_of_scope_access",
] as const;

export type SecurityDiagnosticKind = typeof SECURITY_DIAGNOSTIC_KINDS[number];

const SECURITY_SOURCES: Record<SecurityDiagnosticKind, string> = {
  permission_grant: "apps/permissions",
  permission_revoke: "apps/permissions",
  secret_use: "platform/secrets",
  authentication_failure: "platform/identity",
  origin_rejected: "platform/identity",
  out_of_scope_access: "platform/identity",
};

export type SecurityDiagnostic = {
  kind: SecurityDiagnosticKind;
  source: string;
  at: string;
};

export function classifySecurity(
  kind: SecurityDiagnosticKind,
  at: string,
): SecurityDiagnostic {
  return { kind, source: SECURITY_SOURCES[kind], at };
}
