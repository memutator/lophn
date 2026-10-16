// test runner의 core 쪽 연결. 접수된 RequestTest를 runner(상시 worker kind
// `problems/test-runner`)가 정확히 한 번 시작하게 하고, runner가 끝난 뒤 이미 시작을 시도한 요청을 이어받게 한다.
//
// 정본은 problems 소유 `test_requests` 기록(append-only)이다. 이 모듈은 그 기록을 읽어 다음 일을 정한다:
//   - 접수만 되고 시작 시도가 없으면 runner에 요청 한 건을 보낸다(`problems.test.run`).
//   - 시작 시도는 있는데 결과가 없고 지금 runner가 맡은 것이 아니면(runner가 끝났다) 복구 runner로 이어받는다
//     (`problems.test.recover`). 다시 시작하지 않는다: 실제 시작을 관측했으면 runner_lost inconclusive, 모르면
//     시작 불명이다.
// 접수 기록에는 접수 event가 없으므로 기록을 주기로 읽는다. 요청마다 요청에만 닿는 좁은 machine credential(과 앱
// 보고용 app credential)을 발급해 요청 본문과 함께 감독 pipe로만 runner에 넘긴다.
import { ok, type Result } from "../../../base/mod.ts";
import {
  observeException,
  observeTestRequest,
  problemReport,
  recordVerification,
  stageTestEvidence,
  startTestSide,
} from "../../../protocol/problems/mod.ts";
import type { OperationPolicy } from "../../server/identity/mod.ts";
import type { CredentialIssue } from "../../server/identity/mod.ts";
import { openConnection } from "../../storage/ledger/mod.ts";
import {
  listOpenTestRequests,
  OBSERVE_TEST_REQUEST,
  type OpenTestRequest,
  RECOVER_TEST_REQUEST,
  TEST_BLOB_PURPOSES,
  TEST_RECOVERY_PRINCIPAL,
  TEST_RUNNER_PRINCIPAL,
} from "./mod.ts";
import type { ChildBlobPolicy } from "../../storage/blobs/child-prepare.ts";
import type { WorkerChannel } from "../../supervision/responsiveness/mod.ts";
import { TEST_RUNNER_KIND } from "./runner.ts";

export const TEST_RUN_OP = "problems.test.run";
export const TEST_RECOVER_OP = "problems.test.recover";

// runner가 요청에 쓰는 machine operation. 요청 기록 이음(lifecycle)과 결과 쓰기는 서로 독립이다. 이름 둘은
// 요청별로 owner가 다시 보는 의미 operation이다(problems/tests model).
export const TEST_RUNNER_OPERATIONS = [
  observeTestRequest.name,
  startTestSide.name,
  stageTestEvidence.name,
  recordVerification.name,
  OBSERVE_TEST_REQUEST,
  RECOVER_TEST_REQUEST,
];

// machine은 command kind 정책에만 닿는다.
export function testRunnerPolicies(): OperationPolicy[] {
  return TEST_RUNNER_OPERATIONS.map((name): OperationPolicy => ({
    name,
    actors: ["machine"],
    kind: "command",
  }));
}

const TEST_TASK = "problems";
// 앱 보고를 요청 scope의 mode=test로 접수하게 하는 app credential의 process 조건과 주체다.
const REPORT_PROCESS = "test-runner";
const REPORT_PRINCIPAL = "problems-test-app";
// 요청 하나가 끝나기를 기다리는 한도. 동결 시험 기한 상한(300초)에 준비·결과 쓰기 여유를 더한다. 이 안에 답이
// 없으면 그 runner가 죽은 것으로 보고 이어받는다.
const JOB_TIMEOUT_MS = 720_000;
const RETRY_MS = 5_000;
const SLOTS = [0, 1] as const;

export type TestControlDeps = {
  ledgerPath: string;
  channel: Pick<WorkerChannel, "request" | "failPending">;
  apiPort: number;
  // 요청마다 credential을 발급한다. 발급해 ledger에 기록하고 token과 폐기 방법을 돌려준다.
  issue(
    input: CredentialIssue,
  ): Promise<Result<{ token: string; revoke(): void }>>;
  pollMs?: number;
  nowMs?: () => number;
  // 진단용 한 줄이다. credential·본문은 싣지 않는다.
  log?: (line: string) => void;
};

export type TestControl = {
  // 지금 기록을 읽어 할 일을 한다. 도는 중이면 끝난 뒤 한 번 더 본다.
  wake(): void;
  // runner(감독이 띄운 child)가 끝났다. 맡았던 요청은 사라졌다.
  runnerEnded(): void;
  // 지금 준비하는 blob 주체. 이어받는 중에는 복구 runner, 아니면 runner다.
  blobPrincipal(): string;
  stop(): void;
};

const keyOf = (request: OpenTestRequest) =>
  `${request.request_principal}\u0000${request.request_key}`;

type Outcome = { state: string; reason: string };

function runnerContext(
  principal: string,
  request: OpenTestRequest,
): CredentialIssue {
  return {
    actor: "machine",
    principal,
    scope: {
      operations: [...TEST_RUNNER_OPERATIONS],
      targets: {
        task: TEST_TASK,
        app: request.app,
        request_principal: request.request_principal,
        request_key: request.request_key,
        request_hash: request.request_hash,
      },
    },
    // app 조건은 앱 target을 고정 조건으로도 묶는다(ledger 입구가 조건에서 target을 채운다).
    conditions: {
      task: TEST_TASK,
      process: TEST_RUNNER_KIND,
      app: request.app,
    },
  };
}

function reportContext(
  request: OpenTestRequest,
  scope: string,
): CredentialIssue {
  return {
    actor: `app:${request.app}`,
    principal: REPORT_PRINCIPAL,
    scope: {
      operations: [problemReport.name, observeException.name],
      targets: { app: request.app, process: REPORT_PROCESS, mode: "test" },
    },
    conditions: {
      app: request.app,
      process: REPORT_PROCESS,
      mode: "test",
      bundle_hash: request.payload.target.bundle_hash,
      diagnostic_scope: scope,
    },
  };
}

export function startTestControl(deps: TestControlDeps): TestControl {
  const pollMs = deps.pollMs ?? 500;
  const now = deps.nowMs ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const running = new Map<string, "run" | "recover">();
  // 동시에 도는 요청이 나눠 쓰는 runner socket slot이다.
  const slotOf = new Map<string, 0 | 1>();
  // 다시 시도해도 되는 시각. runner에 닿지 못했거나 시작 시도를 확정하지 못한 요청이다.
  const retryAt = new Map<string, number>();
  // 이어받으려다 닫지 못한 요청이다. 이 core가 사는 동안 다시 시도하지 않는다(기록은 그대로 남는다).
  const abandoned = new Set<string>();
  let mode: "run" | "recover" = "run";
  // runner가 바뀔 때마다 오른다. 끝난 runner에 보냈던 요청의 늦은 정리가 새 runner의 일을 지우지 않게 한다.
  let generation = 0;
  let stopped = false;
  let scanning: Promise<void> | undefined;
  let again = false;
  let connection: ReturnType<typeof openConnection> | undefined;

  function open(): OpenTestRequest[] | undefined {
    connection ??= openConnection(deps.ledgerPath);
    if (!connection.ok) {
      connection = undefined;
      return undefined;
    }
    try {
      return listOpenTestRequests(connection.value.sql);
    } catch {
      connection.value.close();
      connection = undefined;
      return undefined;
    }
  }

  async function send(
    op: string,
    contexts: { runner: CredentialIssue; report?: CredentialIssue },
    body: (token: string, report: string | undefined) => unknown,
  ): Promise<Result<Outcome>> {
    const runner = await deps.issue(contexts.runner);
    if (!runner.ok) return runner;
    const report = contexts.report
      ? await deps.issue(contexts.report)
      : undefined;
    if (report && !report.ok) {
      runner.value.revoke();
      return report;
    }
    try {
      const answered = await deps.channel.request(
        op,
        body(runner.value.token, report?.ok ? report.value.token : undefined),
        JOB_TIMEOUT_MS,
      );
      return answered.ok ? ok(answered.value as Outcome) : answered;
    } finally {
      runner.value.revoke();
      if (report?.ok) report.value.revoke();
    }
  }

  function dispatch(request: OpenTestRequest, slot: 0 | 1): void {
    const key = keyOf(request);
    running.set(key, "run");
    slotOf.set(key, slot);
    const born = generation;
    const scope = `app-test-${request.request_key}`;
    void send(
      TEST_RUN_OP,
      {
        runner: runnerContext(TEST_RUNNER_PRINCIPAL, request),
        report: reportContext(request, scope),
      },
      (token, report) => ({
        request_principal: request.request_principal,
        request_key: request.request_key,
        request_hash: request.request_hash,
        app: request.app,
        connection: request.payload,
        credential: token,
        api_port: deps.apiPort,
        slot,
        report_credential: report,
        diagnostic_scope: scope,
      }),
    ).then((done) => {
      if (!done.ok) {
        log(`test request ${request.request_key}: ${done.error.message}`);
        retryAt.set(key, now() + RETRY_MS);
      } else if (done.value.state === "not_started") {
        log(`test request ${request.request_key}: ${done.value.reason}`);
        retryAt.set(key, now() + RETRY_MS);
      } else if (done.value.state !== "recorded") {
        log(
          `test request ${request.request_key}: ${done.value.state} ${done.value.reason}`,
        );
      }
    }, () => retryAt.set(key, now() + RETRY_MS)).finally(() => {
      // 끝난 runner에 보냈던 요청의 늦은 정리가 새 runner의 일을 지우지 않는다.
      if (born === generation) {
        running.delete(key);
        slotOf.delete(key);
      }
      wake();
    });
  }

  async function recover(request: OpenTestRequest): Promise<void> {
    const key = keyOf(request);
    running.set(key, "recover");
    try {
      const done = await send(
        TEST_RECOVER_OP,
        { runner: runnerContext(TEST_RECOVERY_PRINCIPAL, request) },
        (token) => ({
          request_principal: request.request_principal,
          request_key: request.request_key,
          request_hash: request.request_hash,
          app: request.app,
          connection: request.payload,
          credential: token,
          api_port: deps.apiPort,
          previous_runner: request.current_runner,
          recovered_at: request.recovered_at,
          sides: request.sides,
        }),
      );
      if (!done.ok) {
        // runner에 닿지 못했다. 다음 기회에 다시 이어받는다.
        retryAt.set(key, now() + RETRY_MS);
      } else if (
        done.value.state === "not_started" ||
        done.value.state === "started_unrecorded"
      ) {
        log(`test request ${request.request_key}: ${done.value.reason}`);
        abandoned.add(key);
      }
    } finally {
      running.delete(key);
    }
  }

  async function step(): Promise<void> {
    const requests = open();
    if (requests === undefined) return;
    const at = now();
    const ready = (request: OpenTestRequest) => {
      const key = keyOf(request);
      return !running.has(key) && !abandoned.has(key) &&
        (retryAt.get(key) ?? 0) <= at;
    };
    // 이어받을 것이 먼저다. 시작 시도를 남긴 요청 중 지금 맡은 runner가 없는 것이다.
    const lost = requests.filter((request) =>
      request.attempted && ready(request)
    );
    if (lost.length > 0) {
      // 복구 runner의 주체로 blob을 준비하므로 진행 중인 요청이 끝난 뒤에 한다.
      if (running.size > 0) return;
      mode = "recover";
      try {
        for (const request of lost) {
          if (!stopped) await recover(request);
        }
      } finally {
        mode = "run";
      }
      again = true;
      return;
    }
    for (const request of requests) {
      if (running.size >= SLOTS.length) break;
      if (request.attempted || !ready(request)) continue;
      const taken = new Set(slotOf.values());
      dispatch(request, taken.has(0) ? 1 : 0);
    }
  }

  function wake(): void {
    if (stopped) return;
    if (scanning !== undefined) {
      again = true;
      return;
    }
    scanning = (async () => {
      try {
        do {
          again = false;
          await step();
        } while (again && !stopped);
      } catch {
        // 다음 주기에 다시 읽는다.
      } finally {
        scanning = undefined;
      }
    })();
  }

  const timer = setInterval(wake, pollMs);
  wake();
  return {
    wake,
    runnerEnded() {
      // 맡았던 요청은 사라졌다. 보낸 요청의 답을 기다리지 않고 끝낸다.
      generation += 1;
      deps.channel.failPending("test runner가 끝났다");
      running.clear();
      slotOf.clear();
      mode = "run";
      wake();
    },
    blobPrincipal: () =>
      mode === "recover" ? TEST_RECOVERY_PRINCIPAL : TEST_RUNNER_PRINCIPAL,
    stop() {
      stopped = true;
      clearInterval(timer);
      if (connection?.ok) connection.value.close();
    },
  };
}

// runner가 core에 준비 요청하는 blob의 정책이다. 주체는 지금 맡은 일의 runner 주체다(준비 참조의 주체와
// RecordVerification을 부르는 자격의 주체가 같아야 등록된다).
export function testRunnerBlobPolicy(
  principal: () => string,
): ChildBlobPolicy {
  return {
    get principal() {
      return principal();
    },
    purposes: new Map(
      TEST_BLOB_PURPOSES.map((
        purpose,
      ) => [purpose.purpose, purpose.max_size_bytes] as const),
    ),
  };
}
