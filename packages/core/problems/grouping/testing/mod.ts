// grouping leaf의 테스트 전용 fixture(code-map.md 의존 규칙: 제품 코드와 mod.ts는
// import하지 않는다). 실제 ledger harness가 이 모듈을 등록 모듈로 불러 문제 표와
// read를 올리고, 접수는 제품과 같은 RecordReport command다.
import { z } from "zod";
import { err, ok } from "../../../../base/mod.ts";
import {
  ticketCancelled,
  ticketCheckFailed,
  ticketClaimed,
  ticketClaimReleased,
  ticketCompletionReported,
  ticketConfirmed,
  ticketCreated,
} from "../../../../protocol/coding-agent/mod.ts";
import {
  type AuthenticatedContext,
  type CommandDefinition,
  defineCommand,
} from "../../../../protocol/platform/mod.ts";
import {
  type ProblemTestFact,
  ProblemTestPort,
  ProblemWordingPort,
  ProblemWorkPort,
  type RepairTicketFact,
} from "../../../../protocol/problems/mod.ts";
import type { RecordReportInput } from "../../../../protocol/problems/mod.ts";
import type { Sql } from "../../../../protocol/platform/mod.ts";
import {
  getReportRead,
  getSnapshotRead,
  listReportsRead,
  recordReportCommand,
  REPORTS_SCHEMA_STEPS,
} from "../../reporting/mod.ts";
import { SNAPSHOTS_SCHEMA_STEPS } from "../../snapshots/mod.ts";
import { getProblemRead, listProblemsRead } from "../reads.ts";
import {
  linkProblemInterpretationCommand,
  reconcileProblemWorkCommand,
} from "../commands.ts";

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

// coding-agent ticket 표와 lophn-agent assignment 표의 최소 모양이다. handler가 읽는 열만 같은 이름으로
// 둔다(packages/problems는 그 표를 import하지 못한다). 제품에서는 각 owner의 schema가 만든다.
const TICKET_SCHEMA_STEP = {
  id: "problems.testing_tickets",
  sql: `
create table tickets (
  id text primary key,
  app text not null,
  kind text not null,
  state text not null,
  readiness text not null default 'ready',
  needs text not null default '[]'
) strict;
create table ticket_problems (
  ticket text not null,
  problem text not null,
  primary key (ticket, problem)
) strict;
create table ticket_claims (
  ticket text primary key,
  claim_seq text not null
) strict;
create table assignments (
  id text primary key,
  role text not null,
  scope_kind text not null,
  scope_id text,
  state text not null
) strict;`,
};

const TICKET_EVENTS = [
  "TicketCreated",
  "TicketClaimed",
  "TicketClaimReleased",
  "TicketCompletionReported",
  "TicketCancelled",
  "TicketCheckFailed",
  "TicketConfirmed",
] as const;

// 실제 coding-agent command가 하는 일의 줄임이다: ticket 행·claim 행을 바꾸고 같은 ticket event를
// 낸다. 시험이 ticket 흐름을 ledger에 만들 때만 쓴다.
const ticketEvent = defineCommand({
  resource: "problems",
  method: "test-ticket-event",
  name: "problems.testing.ticket-event",
  input: z.object({
    event: z.enum(TICKET_EVENTS),
    ticket: z.string(),
    app: z.string(),
    kind: z.enum(["repair", "implementation"]).default("repair"),
    problems: z.array(z.string()),
    claim_seq: z.string().default("1"),
    reason: z.string().default("returned"),
    // 만들 때의 실행 준비다. 확인이 필요한 ticket은 needs를 함께 둔다.
    readiness: z.enum(["ready", "needs_confirmation"]).default("ready"),
    needs: z.array(z.string()).default([]),
  }),
  output: z.object({ seq: z.string() }),
  actors: ["machine"],
  errors: [],
});

const STATE_OF: Record<(typeof TICKET_EVENTS)[number], string> = {
  TicketCreated: "open",
  TicketClaimed: "claimed",
  TicketClaimReleased: "open",
  TicketCompletionReported: "reported",
  TicketCancelled: "cancelled",
  TicketCheckFailed: "check_failed",
  TicketConfirmed: "confirmed",
};
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";

const ticketEventCommand: CommandDefinition<typeof ticketEvent> = {
  route: ticketEvent,
  handle(tx, _ctx, input) {
    const { event, ticket, app, problems } = input;
    if (event === "TicketCreated") {
      tx.sql.run(
        `insert into tickets (id, app, kind, state, readiness, needs)
         values (?, ?, ?, 'open', ?, ?)`,
        [ticket, app, input.kind, input.readiness, JSON.stringify(input.needs)],
      );
      for (const problem of problems) {
        tx.sql.run(
          "insert into ticket_problems (ticket, problem) values (?, ?)",
          [ticket, problem],
        );
      }
    } else {
      tx.sql.run("update tickets set state = ? where id = ?", [
        STATE_OF[event],
        ticket,
      ]);
    }
    if (event === "TicketClaimed") {
      tx.sql.run(
        "insert into ticket_claims (ticket, claim_seq) values (?, ?)",
        [
          ticket,
          input.claim_seq,
        ],
      );
    } else if (event !== "TicketCreated") {
      tx.sql.run("delete from ticket_claims where ticket = ?", [ticket]);
    }
    const common = { app, problems };
    const done = {
      completion_seq: "5",
      release: REL,
      fix_records: [],
    };
    const seq = event === "TicketCreated"
      ? tx.emit(ticketCreated, ticket, {
        ...common,
        kind: input.kind,
        readiness: input.readiness,
      })
      : event === "TicketClaimed"
      ? tx.emit(ticketClaimed, ticket, {
        ...common,
        connection: CAC,
        claim_seq: input.claim_seq,
        expires_at: "2026-10-04T13:00:00.000Z",
      })
      : event === "TicketClaimReleased"
      ? tx.emit(ticketClaimReleased, ticket, {
        ...common,
        connection: CAC,
        claim_seq: input.claim_seq,
        reason: input.reason as "returned" | "expired" | "connection_revoked",
      })
      : event === "TicketCompletionReported"
      ? tx.emit(ticketCompletionReported, ticket, {
        ...common,
        completion_seq: "5",
        claim_seq: input.claim_seq,
        release: REL,
        fix_records: [],
        summary_hash: "f".repeat(64),
        outputs: [],
        verifications: [],
      })
      : event === "TicketCancelled"
      ? tx.emit(ticketCancelled, ticket, {
        ...common,
        reason: "no longer needed",
        released_claim: null,
        completion_seq: null,
        fix_records: [],
      })
      : event === "TicketCheckFailed"
      ? tx.emit(ticketCheckFailed, ticket, {
        ...common,
        ...done,
        failed_conditions: [0],
      })
      : tx.emit(ticketConfirmed, ticket, { ...common, ...done });
    return ok({ seq });
  },
};

// App Engineer assignment 행이다. 담당 확인이 읽는 열만 둔다.
const assignmentRow = defineCommand({
  resource: "problems",
  method: "test-assignment",
  name: "problems.testing.assignment",
  input: z.object({
    id: z.string(),
    role: z.string(),
    app: z.string().nullable(),
    state: z.string().default("enabled"),
  }),
  output: z.object({ changed: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

const assignmentRowCommand: CommandDefinition<typeof assignmentRow> = {
  route: assignmentRow,
  handle(tx, _ctx, input) {
    tx.sql.run(
      `insert into assignments (id, role, scope_kind, scope_id, state)
       values (?, ?, ?, ?, ?)`,
      [
        input.id,
        input.role,
        input.app === null ? "all" : "app",
        input.app,
        input.state,
      ],
    );
    return ok({ changed: true });
  },
};

// 선언 code의 당시 문구를 테스트에서 정한다. 제품에서는 apps/releases store가 보고 당시
// release의 blueprint를 읽지만, 이 fixture는 문제 표와 별도 표에 두고 read가 같은 port로
// 읽는다. release별로 정하고 지우면 보고했던 당시 선언이 사라진다.
const setWording = defineCommand({
  resource: "problems",
  method: "set-test-wording",
  name: "problems.testing.set-wording",
  input: z.object({
    release: z.string(),
    code: z.string(),
    message: z.string().nullable(),
    message_key: z.string().nullable(),
    fixer: z.enum(["coding_agent", "user"]).nullable(),
    app_name: z.string().nullable(),
  }),
  output: z.object({ changed: z.boolean() }),
  actors: ["machine"],
  errors: ["not_found"],
});

// release·code → 선언. 지운 row는 없는 것과 같다.
const WORDING_SCHEMA_STEP = {
  id: "problems.testing_wording",
  sql: `
create table test_wording (
  release text not null,
  code text not null,
  message text not null,
  message_key text not null,
  fixer text not null,
  primary key (release, code)
) strict;`,
};

const setWordingCommand: CommandDefinition<typeof setWording> = {
  route: setWording,
  handle(tx, _ctx, input) {
    if (input.message === null) {
      const changed = tx.sql.run(
        "delete from test_wording where release = ? and code = ?",
        [input.release, input.code],
      );
      return ok({ changed: Number(changed.changes) > 0 });
    }
    tx.sql.run(
      `insert into test_wording (release, code, message, message_key, fixer)
       values (?, ?, ?, ?, ?)`,
      [
        input.release,
        input.code,
        input.message,
        input.message_key ?? "app-detail.issue.declared",
        input.fixer ?? "coding_agent",
      ],
    );
    return ok({ changed: true });
  },
};

const APP_NAME_SCHEMA_STEP = {
  id: "problems.testing_app_name",
  sql: `
create table test_app_name (
  app text primary key,
  name text not null
) strict;`,
};

// 앱 등록 기록의 이름을 테스트에서 정한다. 제품에서는 apps 표를 읽는다.
const setAppName = defineCommand({
  resource: "problems",
  method: "set-test-app-name",
  name: "problems.testing.set-app-name",
  input: z.object({
    app: z.string(),
    name: z.string().nullable(),
  }),
  output: z.object({ changed: z.boolean() }),
  actors: ["machine"],
  errors: ["not_found"],
});

const setAppNameCommand: CommandDefinition<typeof setAppName> = {
  route: setAppName,
  handle(tx, _ctx, input) {
    if (input.name === null) {
      const changed = tx.sql.run(
        "delete from test_app_name where app = ?",
        [input.app],
      );
      return ok({ changed: Number(changed.changes) > 0 });
    }
    tx.sql.run(
      "insert into test_app_name (app, name) values (?, ?)",
      [input.app, input.name],
    );
    return ok({ changed: true });
  },
};

// 문구 port의 fixture 구현이다. 제품 구현(apps/releases store의 releaseWording)은 보고
// 당시 release의 blueprint를 읽지만, 이 fixture는 테스트 표의 선언으로 같은 contract의
// 답을 낸다. 문제 표의 read가 snapshot sql로 이 port를 읽는다. 앱 이름은 선언이 없어도
// 부르는 쪽이 fallback에 붙일 수 있게 항상 준다.
const fixtureWording = (
  sql: Pick<Sql, "get">,
  app: string,
  release: string,
  code: string,
) => {
  const nameRow = sql.get("select name from test_app_name where app = ?", [
    app,
  ]);
  const app_name = nameRow === undefined ? app : String(nameRow.name);
  const row = sql.get(
    "select message, message_key, fixer from test_wording where release = ? and code = ?",
    [release, code],
  );
  const declared = row === undefined ? null : {
    message: String(row.message),
    message_key: String(row.message_key),
    fixer: String(row.fixer) as "coding_agent" | "user",
  };
  return ok({ app_name, declaration: declared });
};

// 지금 수리 ticket port의 fake다(problems#T22). 제품 구현(coding-agent의 problemWorkLookup)은
// repair 예약 표를 읽지만, 이 fixture는 `problems.testing.ticket-event`가 만든 최소 ticket 표에서
// 문제에 걸린 끝나지 않은 repair ticket을 고르고, 없으면 문제의 work ticket을 읽는다. work가
// 가리키는 ticket이 fixture 표에 없으면 읽지 못한 것(unavailable)이라 상세는 담당을 모름으로 보인다.
const OPEN_TICKET_STATES = ["open", "claimed", "reported", "check_failed"];
const fixtureProblemWork = (
  sql: Pick<Sql, "get">,
  problem: string,
  work: string | null,
) => {
  const open = sql.get(
    `select t.state, t.readiness, t.needs from tickets t
     join ticket_problems p on p.ticket = t.id
     where p.problem = ? and t.kind = 'repair'
       and t.state in (${OPEN_TICKET_STATES.map(() => "?").join(", ")})
     order by t.rowid desc limit 1`,
    [problem, ...OPEN_TICKET_STATES],
  );
  const row = open ?? (work === null ? undefined : sql.get(
    "select state, readiness, needs from tickets where id = ?",
    [work],
  ));
  if (row === undefined) {
    return work === null
      ? ok(null)
      : err({ code: "unavailable", message: "fixture ticket이 없다" });
  }
  return ok({
    state: String(row.state) as RepairTicketFact["state"],
    readiness: String(row.readiness) as RepairTicketFact["readiness"],
    needs: JSON.parse(String(row.needs)) as string[],
  });
};

// 테스트 사실 port의 fake다(problems#T22). 제품 구현(tests leaf의 problemTestLookup)은
// verifications·test_requests를 읽지만, 이 fixture는 시험이 `problems.testing.set-tests`로 정한
// 문제별 사실을 그대로 준다. 정하지 않은 문제는 읽지 못한 것(unavailable)이라 상세는 모름이다.
const TESTS_SCHEMA_STEP = {
  id: "problems.testing_problem_tests",
  sql: `
create table test_problem_tests (
  problem text primary key,
  facts text not null
) strict;`,
};

const setTests = defineCommand({
  resource: "problems",
  method: "set-test-facts",
  name: "problems.testing.set-tests",
  input: z.object({
    problem: z.string(),
    tests: z.array(z.object({
      kind: z.enum(["reproduction", "app_test", "test_command"]),
      state: z.enum(["pending", "running", "pass", "fail", "unconfirmed"]),
      ended_at: z.string().nullable(),
    })),
  }),
  output: z.object({ changed: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

const setTestsCommand: CommandDefinition<typeof setTests> = {
  route: setTests,
  handle(tx, _ctx, input) {
    tx.sql.run(
      `insert into test_problem_tests (problem, facts) values (?, ?)
       on conflict (problem) do update set facts = excluded.facts`,
      [input.problem, JSON.stringify(input.tests)],
    );
    return ok({ changed: true });
  },
};

const fixtureProblemTests = (sql: Pick<Sql, "get">, problem: string) => {
  const row = sql.get(
    "select facts from test_problem_tests where problem = ?",
    [problem],
  );
  return row === undefined
    ? err({ code: "unavailable", message: "fixture 테스트 사실이 없다" })
    : ok(JSON.parse(String(row.facts)) as ProblemTestFact[]);
};

export function createLedgerTestRegistration() {
  return {
    schemaSteps: [
      ...REPORTS_SCHEMA_STEPS,
      ...SNAPSHOTS_SCHEMA_STEPS,
      WORDING_SCHEMA_STEP,
      APP_NAME_SCHEMA_STEP,
      TICKET_SCHEMA_STEP,
      TESTS_SCHEMA_STEP,
    ],
    commands: [
      recordReportCommand,
      reconcileProblemWorkCommand,
      linkProblemInterpretationCommand,
    ] as CommandDefinition[],
    testCommands: [
      arrangeCommand,
      setWordingCommand,
      setAppNameCommand,
      ticketEventCommand,
      assignmentRowCommand,
      setTestsCommand,
    ] as CommandDefinition[],
    readPorts: new Map<unknown, unknown>([
      [ProblemWordingPort, fixtureWording],
      [ProblemWorkPort, fixtureProblemWork],
      [ProblemTestPort, fixtureProblemTests],
    ]),
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
    operations: [
      "RecordReport",
      "problems.testing.arrange",
      "problems.testing.set-wording",
      "problems.testing.set-app-name",
      "problems.testing.ticket-event",
      "problems.testing.assignment",
      "problems.testing.set-tests",
      "ReconcileProblemWork",
    ],
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
