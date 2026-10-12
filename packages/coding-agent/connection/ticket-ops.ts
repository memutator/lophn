// ticket 쓰기 op의 공통 흐름이다. MCP `lophn_ticket`
// 과 CLI `ticket`이 같은 소유 route·같은 입력·같은 결과를 쓴다.
// 완료 보고는 summary 본문을 받아 hash를 내고 `tickets/upload_summary`로 바이트를 올린 뒤 그
// 준비 참조로 `report_completion`을 보낸다. completion seq는 입력이 아니고 core가 부여한다.
// 통로는 기한을 정하거나 claim을 갱신하지 않는다: 만료·반납·취소 뒤 보고는 core의 거절이
// 그대로 나온다.
import { type LophnError, type Result, sha256Hex } from "../../base/mod.ts";
import {
  ticketChecks,
  ticketReportCompletion,
  ticketShow,
  ticketSummaryBlobSchema,
  ticketUploadSummary,
} from "../../protocol/coding-agent/mod.ts";
import type {
  CommandRoute,
  Route,
  UploadRoute,
} from "../../protocol/base/mod.ts";

// core client 중 ticket 쓰기가 쓰는 호출이다. client/core.ts는 core module graph 밖이라 구조로만 좁힌다.
export type TicketOpClient = {
  command(
    route: CommandRoute,
    body: {
      input: unknown;
      idempotency_key: string;
      compare?: unknown;
      prepared?: readonly string[];
    },
  ): Promise<Result<unknown, LophnError>>;
  read(route: Route, input: unknown): Promise<Result<unknown, LophnError>>;
  upload(
    route: UploadRoute,
    input: unknown,
    bytes: ReadableStream<Uint8Array>,
  ): Promise<Result<unknown, LophnError>>;
};

export type TicketOpDeps = {
  client: TicketOpClient;
  idempotencyKey: () => string;
};

export type TicketOpOutput = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

// claim·renew·release·report의 CAS 비교다. 소유 route가 `base_revision`을 요구한다.
export function ticketCompare(input: Record<string, unknown>): {
  base_revision: unknown;
} {
  return { base_revision: input.base_revision };
}

const REPORT_KEYS = [
  "ticket",
  "base_revision",
  "claim_seq",
  "release",
  "summary",
  "outputs",
  "fix_records",
  "verifications",
] as const;

type ShownTicket = {
  state?: string;
  conditions?: { position?: number; kind?: string }[];
};
type CheckRow = { condition?: number; result?: string };

// 완료 주장·보고 접수·확인 실패·approval 대기·activation·문제 정상 확인을 따로 읽는다.
// 보고만으로 confirmed나 문제 닫힘을 만들지 않는다: 이 값은 모두 원래 ticket의 읽기에서
// 온다. 조건이 없으면 not_required, 읽지 못하면 unread다.
function followUp(
  shown: Result<unknown, LophnError>,
  checked: Result<unknown, LophnError>,
) {
  if (!shown.ok) {
    return {
      check: { state: "unread", results: [] as unknown[] },
      approval_wait: null,
      activation: { required: null, state: "unread" },
      problems_confirmed: { required: null, state: "unread" },
    };
  }
  const ticket = (shown.value as { ticket?: ShownTicket }).ticket ?? {};
  const rows = checked.ok
    ? ((checked.value as { checks?: CheckRow[] }).checks ?? [])
    : [];
  const resultOf = (kind: string) => {
    const condition = (ticket.conditions ?? []).find((item) =>
      item.kind === kind
    );
    if (condition === undefined) {
      return { required: false, state: "not_required" };
    }
    const row = rows.find((item) => item.condition === condition.position);
    return { required: true, state: row?.result ?? "pending" };
  };
  const activation = resultOf("release_active");
  const state = ticket.state === "confirmed"
    ? "confirmed"
    : ticket.state === "check_failed"
    ? "check_failed"
    : "pending";
  return {
    check: { state, results: rows },
    // release activation은 사람이 고른다. 그 조건이 아직 통과하지 않았으면 승인 대기다.
    approval_wait: activation.required && activation.state !== "pass",
    activation,
    problems_confirmed: resultOf("problems_closed"),
  };
}

function failure(
  stage: "upload" | "report",
  error: LophnError,
): TicketOpOutput {
  return {
    summary: stage === "upload"
      ? `summary를 올리지 못했다: ${error.message}`
      : `보고가 거절됐다: ${error.message}`,
    data: {
      stage,
      code: error.code,
      details: error.details ?? {},
      report: { accepted: false },
    },
    next: [
      "ticket show로 현재 state와 claim을 읽는다. 만료·반납·취소된 claim으로는 보고할 수 없고 통로가 claim을 갱신하지 않는다",
    ],
    isError: true,
  };
}

export async function reportTicket(
  rawInput: unknown,
  deps: TicketOpDeps,
): Promise<TicketOpOutput> {
  const input = rawInput as Record<string, unknown>;
  const bytes = new TextEncoder().encode(String(input.summary));
  const hash = await sha256Hex(bytes);
  const uploaded = await deps.client.upload(
    ticketUploadSummary,
    { blob_hash: hash, bytes: bytes.length },
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
  if (!uploaded.ok) return failure("upload", uploaded.error);
  const blob = ticketSummaryBlobSchema.safeParse(uploaded.value);
  if (!blob.success || blob.data.hash !== hash) {
    return failure("upload", {
      code: "internal",
      message: "준비된 summary가 올린 바이트와 맞지 않는다",
    });
  }
  const sent = await deps.client.command(ticketReportCompletion, {
    input: {
      ticket: input.ticket,
      base_revision: input.base_revision,
      claim_seq: input.claim_seq,
      completion: {
        release: input.release,
        summary_hash: hash,
        outputs: input.outputs ?? [],
        fix_records: input.fix_records ?? [],
        verifications: input.verifications ?? [],
      },
      summary_blob: blob.data,
    },
    idempotency_key: deps.idempotencyKey(),
    compare: ticketCompare(input),
    prepared: [blob.data.preparation],
  });
  if (!sent.ok) return failure("report", sent.error);
  const reported = sent.value as { ticket?: string; completion_seq?: string };
  const [shown, checked] = await Promise.all([
    deps.client.read(ticketShow, { ticket: input.ticket }),
    deps.client.read(ticketChecks, { ticket: input.ticket }),
  ]);
  const follow = followUp(shown, checked);
  return {
    summary: `report ${
      reported.ticket ?? String(input.ticket)
    } completion_seq ${reported.completion_seq ?? "?"} 접수됨. 확인은 ${
      follow.check.state === "pending" ? "아직" : follow.check.state
    }이고 보고만으로 확인됨이나 문제 닫힘이 되지 않는다`,
    data: {
      ticket: reported.ticket ?? input.ticket,
      completion_claim: {
        claimed: true,
        completion_seq: reported.completion_seq ?? null,
        release: input.release,
        summary_hash: hash,
      },
      report: { accepted: true, state: "reported" },
      ...follow,
    },
    next: [
      "ticket checks로 조건별 검사 결과를 읽는다",
      "activation·문제 확인은 사람이 정한다. 이 보고는 그것을 대신하지 않는다",
    ],
  };
}

// CLI·MCP가 같은 입력만 route로 넘기게 report 입력의 알려진 key만 남긴다.
export function reportInputOf(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of REPORT_KEYS) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  return body;
}
