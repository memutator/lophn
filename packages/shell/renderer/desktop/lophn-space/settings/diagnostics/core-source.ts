// DiagnosticsSource를 main의 core 통로로 만든다. 결과는 contract read(diagnostics/check)다.
// finding의 영향·다음 행동은 화면이 check 이름에서 정한다: 원문 message는 여기를 지나지 않는다.
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import type {
  DiagnosticCheckName,
  DiagnosticRow,
  DiagnosticsSource,
  DiagnosticsView,
  SourceResult,
} from "./source.ts";

interface CheckValue {
  checks: {
    check: string;
    observed_at: string;
    finding: { message: string | null } | null;
  }[];
  observed_at: string;
}

type FindingImpact = "wide_grant" | "raw_key";

const IMPACT: Readonly<Partial<Record<DiagnosticCheckName, FindingImpact>>> = {
  broad_grant: "wide_grant",
  unused_grant: "wide_grant",
  raw_key_pattern: "raw_key",
};

/** 문제를 사람 말로 옮길 항목. 나머지(credential_permission 등)는 finding이 있어도 영향을 정하지 않는다. */
const KNOWN = new Set(Object.keys(IMPACT));

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function coreDiagnosticsSource(core: CoreSource): DiagnosticsSource {
  return {
    async check() {
      const read = await call<CheckValue>(
        core,
        "read",
        "diagnostics",
        "check",
        {},
      );
      if (!read.ok) return read;
      const rows: DiagnosticRow[] = [];
      for (const entry of read.value.checks) {
        const check = entry.check as DiagnosticCheckName;
        if (entry.finding === null || !KNOWN.has(check)) {
          rows.push({ check, finding: null });
          continue;
        }
        const impact = IMPACT[check];
        if (impact === undefined) {
          rows.push({ check, finding: null });
          continue;
        }
        const message = entry.finding.message;
        rows.push({
          check,
          finding: {
            impact,
            // 원문 finding message. 개발자 diagnostics 펼침에만 보인다(shell/wording#R8).
            raw: message ?? "",
            at: entry.observed_at,
          },
        });
      }
      const view: DiagnosticsView = {
        rows,
        observedAt: read.value.observed_at,
      };
      return { ok: true, value: view };
    },
  };
}
