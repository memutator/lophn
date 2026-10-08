// `lophn session summary|plan|observe` command 표와 summary·plan·observe 실행이다(cli#R40). summary는 `lophn_session`의
// 결과를 같은 read route(`/v1/coding_agent_sessions/summary`)로 읽는다. `--hook`이면 Claude Code 세션 시작 hook의
// 출력 글 하나를 내고 어떤 실패도 빈 값으로 끝낸다(guides#R23, R24). 일반 summary는 실패를 그대로 보인다. plan은 sessions의 LaunchPlan 입출력이고 spawn이 아니다(coding-agent#T38): shell main이
// 클릭을 검증하며 넘긴 값으로 plan이나 자기 터미널 안내를 낸다. shell terminal host가 plan을 연다. observe는
// 제품 hook·plugin·extension이 stdin으로 준 payload를 정규화해 `LOPHN_TERMINAL_OBSERVE` socket에만 쓰고 core·credential을
// 부르지 않는다(coding-agent#T39, sessions#R6, R9).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliSessionObserveSchema,
  cliSessionPlanSchema,
  cliSessionSummarySchema,
  type CodingAgentSessionSummary,
  codingAgentSessionSummary,
  type HarnessDetection,
  type HarnessId,
  LOPHN_TERMINAL_OBSERVE,
  type SessionPlanInput,
} from "../../../contracts/coding-agent/mod.ts";
import { runSummaryHookBounded } from "../../guides/mod.ts";
import { launchPlanOf, observeStream } from "../../sessions/mod.ts";
import type { Route } from "../../../contracts/platform/mod.ts";
import { UNREADABLE_MESSAGE } from "../../connection/mod.ts";
import type { CommandOutput } from "./connection.ts";
import type { CommandEntry } from "./types.ts";

export const SESSION_COMMANDS: readonly CommandEntry[] = [
  { name: "session summary", input: cliSessionSummarySchema },
  { name: "session plan", input: cliSessionPlanSchema },
  { name: "session observe", input: cliSessionObserveSchema },
];

export type SessionSummaryDeps = {
  // 연결 참조가 없으면 undefined다.
  client: {
    read(route: Route, input: unknown): Promise<Result<unknown, LophnError>>;
  } | undefined;
};

// hook 출력 글은 data.hook이다. 빈 값은 stdout 빈 값·exit 0이고 hook은 연결이 없어도 실패하지 않는다.
export async function runSessionSummary(
  input: { app?: string; cursor?: string; hook?: boolean },
  deps: SessionSummaryDeps,
): Promise<Result<CommandOutput, LophnError>> {
  const client = deps.client;
  if (input.hook === true) {
    const text = client === undefined || input.app === undefined
      ? ""
      : await runSummaryHookBounded(async (request) => {
        const read = await client.read(codingAgentSessionSummary, request);
        if (!read.ok) return read;
        const checked = codingAgentSessionSummary.output.safeParse(read.value);
        return checked.success
          ? ok(checked.data.summary as CodingAgentSessionSummary)
          : err({
            code: "unavailable",
            message: "읽기 응답이 contract와 다르다",
          });
      }, input.app);
    return ok({ summary: text, data: { hook: text }, next: [] });
  }
  if (client === undefined) {
    return err({
      code: "invalid_input",
      message: "연결 참조가 필요하다(--connection 또는 LOPHN_CONNECTION)",
    });
  }
  const read = await client.read(codingAgentSessionSummary, {
    ...(input.app === undefined ? {} : { app: input.app }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
  if (!read.ok) {
    // 없는 대상과 범위 밖 대상은 같은 답이다(connection#R5).
    return read.error.code === "not_found"
      ? err({ code: "not_found", message: UNREADABLE_MESSAGE })
      : read;
  }
  const checked = codingAgentSessionSummary.output.safeParse(read.value);
  if (!checked.success) {
    return err({
      code: "unavailable",
      message: "읽기 응답이 contract와 다르다",
    });
  }
  const summary = checked.data.summary;
  return ok({
    summary:
      `열린 문제 ${summary.problems.length}개, 열린 ticket ${summary.tickets.length}개, 내 claim ${summary.claims.length}개, 남은 검사 ${summary.remaining_checks.length}개`,
    data: checked.data,
    next: [
      summary.claim_rule,
      "ticket 상세는 `lophn ticket show`로 읽는다",
      ...(summary.next_cursor === null
        ? []
        : ["--cursor로 next_cursor를 넣어 이어 읽는다"]),
    ],
  });
}

export type SessionPlanDeps = {
  // 저장한(없으면 처음 본) 감지 결과다. 재감지나 version·auth probe를 돌리지 않는다(harnesses#R2).
  detect(): Promise<Result<readonly HarnessDetection[]>>;
  // 지금 PATH·catalog 위치에서 다시 본 실행 파일이다. 감지 뒤 옮겨졌는지 확인한다(R4).
  current(harness: HarnessId): Result<{ selected: string | null }>;
};

export async function runSessionPlan(
  input: { plan_input: SessionPlanInput },
  deps: SessionPlanDeps,
): Promise<Result<CommandOutput, LophnError>> {
  const request = input.plan_input;
  let detection: HarnessDetection | null = null;
  let current: { selected: string | null } | null = null;
  if (request.harness_id !== undefined) {
    const detected = await deps.detect();
    if (detected.ok) {
      detection = detected.value.find((item) =>
        item.harness_id === request.harness_id
      ) ?? null;
    }
    const seen = deps.current(request.harness_id);
    current = seen.ok ? seen.value : null;
  }
  const made = launchPlanOf(request, { detection, current });
  if (!made.ok) return made;
  if (made.value.kind === "guide") {
    return ok({
      summary:
        "자기 터미널에서 직접 시작하는 안내다. lophn은 process를 열지 않는다",
      data: { guide: made.value.guide },
      next: ["사람이 자기 터미널에서 안내대로 시작한다"],
    });
  }
  return ok({
    summary: "시작 계획이다. 이 command는 process를 열지 않는다",
    data: { plan: made.value.plan },
    next: [
      "shell terminal host가 이 계획으로 project 터미널 탭에 연다",
    ],
  });
}

export type SessionObserveDeps = {
  env: { get(name: string): string | undefined };
  // hook이 stdin으로 준 payload 전체다. socket이 없으면 읽지 않는다.
  stdin(): Promise<string>;
  now(): string;
  // 관측 socket에 NDJSON을 쓴다. 이 socket은 observation 전용이다.
  send(path: string, ndjson: string): Promise<Result<void, LophnError>>;
};

// 환경에 관측 socket이 없으면(자기 터미널 등) 아무것도 읽거나 보내지 않는다. runtime_ref·generation·origin은
// host가 자기 등록 channel에서 붙이므로 여기서는 쓰지 않는다(R8).
export async function runSessionObserve(
  input: { hook: HarnessId },
  deps: SessionObserveDeps,
): Promise<Result<CommandOutput, LophnError>> {
  const path = deps.env.get(LOPHN_TERMINAL_OBSERVE);
  if (path === undefined || path === "") {
    return ok({
      summary: "관측 socket이 없어 보내지 않았다",
      data: { sent: 0, ignored: 0, rejected: 0 },
      next: [],
    });
  }
  if (!path.startsWith("/") || /\p{Cc}/u.test(path)) {
    return err({
      code: "invalid_input",
      message: "관측 socket 경로가 맞지 않는다",
    });
  }
  const outcome = observeStream(input.hook, await deps.stdin(), {
    now: deps.now(),
  });
  if (outcome.observations.length > 0) {
    const sent = await deps.send(
      path,
      outcome.observations.map((item) => `${JSON.stringify(item)}\n`).join(""),
    );
    if (!sent.ok) return sent;
  }
  return ok({
    summary: "관측을 보냈다",
    data: {
      sent: outcome.observations.length,
      ignored: outcome.ignored,
      rejected: outcome.rejected,
    },
    next: [],
  });
}
