// `lophn session summary|plan|observe` command 표와 plan·observe 실행이다(cli#R40). summary는 `lophn_session`의 결과를
// 같은 read route로 읽고 그 core route가 아직 없으면 실행은 성공으로 꾸미지 않고 unavailable이다
// (dispatch). plan은 sessions의 LaunchPlan 입출력이고 spawn이 아니다(coding-agent#T38): shell main이
// 클릭을 검증하며 넘긴 값으로 plan이나 자기 터미널 안내를 낸다. shell terminal host가 plan을 연다. observe는
// 제품 hook·plugin·extension이 stdin으로 준 payload를 정규화해 `LOPHN_TERMINAL_OBSERVE` socket에만 쓰고 core·credential을
// 부르지 않는다(coding-agent#T39, sessions#R6, R9).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliSessionObserveSchema,
  cliSessionPlanSchema,
  cliSessionSummarySchema,
  type HarnessDetection,
  type HarnessId,
  LOPHN_TERMINAL_OBSERVE,
  type SessionPlanInput,
} from "../../../contracts/coding-agent/mod.ts";
import { launchPlanOf, observeStream } from "../../sessions/mod.ts";
import type { CommandOutput } from "./connection.ts";
import type { CommandEntry } from "./types.ts";

export const SESSION_COMMANDS: readonly CommandEntry[] = [
  { name: "session summary", input: cliSessionSummarySchema },
  { name: "session plan", input: cliSessionPlanSchema },
  { name: "session observe", input: cliSessionObserveSchema },
];

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
