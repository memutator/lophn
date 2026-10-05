// grouping leaf의 테스트 전용 fixture(code-map.md 의존 규칙: 제품 코드와 mod.ts는
// import하지 않는다). 실제 ledger harness가 이 모듈을 등록 모듈로 불러 문제 표와
// read를 올리고, 접수는 제품과 같은 RecordReport command다.
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  type CommandDefinition,
  defineCommand,
} from "../../../contracts/platform/mod.ts";
import type { RecordReportInput } from "../../../contracts/problems/mod.ts";
import {
  getReportRead,
  getSnapshotRead,
  listReportsRead,
  recordReportCommand,
  REPORTS_SCHEMA_STEPS,
} from "../../reporting/mod.ts";
import { SNAPSHOTS_SCHEMA_STEPS } from "../../snapshots/mod.ts";
import { getProblemRead, listProblemsRead } from "../reads.ts";

// 진행 전환·해석 연결·닫힘 command는 뒤 작업(ReconcileProblemWork 등)이 만든다. 그 전에
// 읽기가 보는 모든 상태를 만들 수 있게 문제 행의 상태 열을 테스트에서만 정한다.
const arrange = defineCommand({
  resource: "problems",
  method: "arrange-test-state",
  name: "problems.testing.arrange",
  input: z.object({
    problem: z.string(),
    status: z.enum(["open", "fixing", "closed"]),
    work: z.string().nullable(),
    closure: z.string().nullable(),
    interpretation_version: z.string().nullable(),
    interpretation_section: z.string().nullable(),
  }),
  output: z.object({ changed: z.boolean() }),
  actors: ["machine"],
  errors: ["not_found"],
});

const arrangeCommand: CommandDefinition<typeof arrange> = {
  route: arrange,
  handle(tx, _ctx, input) {
    const changed = tx.sql.run(
      `update problems set status = ?, work = ?, closure = ?,
         interpretation_version = ?, interpretation_section = ? where id = ?`,
      [
        input.status,
        input.work,
        input.closure,
        input.interpretation_version,
        input.interpretation_section,
        input.problem,
      ],
    );
    return Number(changed.changes) === 1
      ? ok({ changed: true })
      : err({ code: "not_found", message: "문제가 없다" });
  },
};

export function createLedgerTestRegistration() {
  return {
    schemaSteps: [...REPORTS_SCHEMA_STEPS, ...SNAPSHOTS_SCHEMA_STEPS],
    commands: [recordReportCommand as CommandDefinition],
    testCommands: [arrangeCommand as CommandDefinition],
    // harness에는 blob 저장소가 없다. 준비 참조가 맞는지만 보고 그대로 등록한다.
    registerBlobRef(
      _tx: unknown,
      _ctx: unknown,
      reference: {
        owner_kind: string;
        owner_key: string;
        field: string;
        registered_seq: string;
        source: { kind: string; blob?: { hash: string } };
      },
    ) {
      if (reference.source.kind !== "prepared" || !reference.source.blob) {
        return err({ code: "forbidden", message: "prepared blob만 등록한다" });
      }
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.blob.hash,
        registered_seq: reference.registered_seq,
      });
    },
    reads: [
      listProblemsRead,
      getProblemRead,
      listReportsRead,
      getReportRead,
      getSnapshotRead,
    ],
  };
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
function serialSuffix(serial: number): string {
  return `${ALPHABET[Math.floor(serial / 32) % 32]}${ALPHABET[serial % 32]}`;
}
export const rpt = (serial: number): `rpt_${string}` =>
  `rpt_01arz3ndektsv4rrffq69g5f${serialSuffix(serial)}`;
export const snp = (serial: number): `snp_${string}` =>
  `snp_01arz3ndektsv4rrffq69g5f${serialSuffix(serial)}`;
export const APP_A = "app_01arz3ndektsv4rrffq69g5fav";
export const APP_B = "app_01arz3ndektsv4rrffq69g5faw";
export const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
export const STACK_HASH = "b".repeat(64);
const TEXT_HASH = "d".repeat(64);
export const ERROR_MESSAGE = "boom: card 4111 declined for ada@example.test";

export const COLLECTOR: AuthenticatedContext = {
  principal: "collector-1",
  actor: "machine",
  scope: {
    operations: ["RecordReport", "problems.testing.arrange"],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-collector",
};

export type ReportSpec = {
  serial: number;
  app?: string;
  kind?: "exception" | "declared" | "feedback" | "invalid_report";
  code?: string;
  mode?: "live" | "preview" | "test";
  scope?: string;
  observedAt?: string;
  release?: string | null;
  discriminator?: string;
};

const AT = "2026-10-04T12:00:00.000Z";

// kind별 group key와 source·code가 contract의 짝을 지킨다.
export function reportInput(spec: ReportSpec): RecordReportInput {
  const app = spec.app ?? APP_A;
  const kind = spec.kind ?? "exception";
  const mode = spec.mode ?? "live";
  const id = rpt(spec.serial);
  const observedAt = spec.observedAt ?? AT;
  const release = spec.release === undefined ? RELEASE : spec.release;
  const code = kind === "declared"
    ? spec.code ?? "payment_declined"
    : kind === "exception"
    ? "_exception"
    : kind === "feedback"
    ? "_feedback"
    : "_invalid_report";
  const source = kind === "declared" || kind === "invalid_report"
    ? "app"
    : kind;
  const scope = mode === "live" ? null : spec.scope ?? "scope-1";
  // 보고 출처마다 인증 주체가 정해져 있다(app 자신, 관측기, 사람이 쓴 shell).
  const authentication: AuthenticatedContext = kind === "feedback"
    ? { ...COLLECTOR, principal: "user-1", actor: "user" }
    : kind === "exception"
    ? COLLECTOR
    : { ...COLLECTOR, principal: `app-${app}`, actor: `app:${app}` };
  const origin = kind === "feedback"
    ? "shell_user"
    : kind === "exception"
    ? "process_observer"
    : "app";
  const report = {
    id,
    app,
    mode,
    diagnostic_scope: scope,
    release,
    release_missing_reason: release === null ? "release unknown" : null,
    bundle_hash: "a".repeat(64),
    source,
    code,
    text: kind === "feedback" ? TEXT_HASH : null,
    details: null,
    snapshot: snp(spec.serial),
    observed_at: observedAt,
    principal: authentication.principal,
    content_hash: "a".repeat(64),
  } as RecordReportInput["report"];
  const withStack = kind === "exception";
  const snapshot: RecordReportInput["snapshot"] = {
    id: snp(spec.serial),
    captured_at: observedAt,
    invocation: null,
    invocation_missing_reason: { reason: "no invocation known" },
    error: withStack
      ? {
        name: "TypeError",
        message: ERROR_MESSAGE,
        message_missing_reason: null,
        frames: [{ path: "src/pay.ts", function: "pay", line: 3, column: 9 }],
        source_missing_reason: null,
        stack: STACK_HASH,
        stack_missing_reason: null,
        truncation_notes: [],
      }
      : null,
    error_missing_reason: withStack ? null : { reason: "no error" },
    logs: null,
    logs_missing_reason: { reason: "logs off" },
    screen: null,
    screen_missing_reason: { reason: "not collected" },
  };
  const group_key =
    (kind === "declared"
      ? { kind, code, discriminator: null }
      : kind === "exception"
      ? { kind, code: "_exception", discriminator: spec.discriminator ?? id }
      : kind === "feedback"
      ? { kind, code: "_feedback", discriminator: id }
      : {
        kind,
        code: "_invalid_report",
        discriminator: "payment_typo",
      }) as RecordReportInput["group_key"];
  return {
    report,
    snapshot,
    group_key,
    existing_problem: null,
    blobs: [
      ...(kind === "exception"
        ? [preparedBlob(authentication, "snapshot_stack", STACK_HASH)]
        : []),
      ...(kind === "feedback"
        ? [preparedBlob(authentication, "report_text", TEXT_HASH)]
        : []),
    ],
    origin: {
      context: {
        authentication,
        app,
        mode,
        diagnostic_scope: scope,
        release,
        release_missing_reason: report.release_missing_reason,
        bundle_hash: "a".repeat(64),
        binding: "test-binding",
        origin,
      },
      report_id: id,
      content_hash: "a".repeat(64),
    },
  } as RecordReportInput;
}

function preparedBlob(
  authentication: AuthenticatedContext,
  purpose: "snapshot_stack" | "report_text",
  hash: string,
): RecordReportInput["blobs"][number] {
  return {
    hash,
    size_bytes: 64,
    purpose,
    source: {
      kind: "prepared",
      blob: {
        preparation: `prep-${purpose}`,
        principal: authentication.principal,
        hash,
        size_bytes: 64,
        purpose,
      },
    },
  } as RecordReportInput["blobs"][number];
}
