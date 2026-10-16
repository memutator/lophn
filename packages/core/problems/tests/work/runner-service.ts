// test runner control의 상시 service다. core 감독이 하나를 띄우고, core가
// 감독 pipe로 보내는 요청 한 건(`problems.test.run`)을 받아 실제 runner 경로(app-test-run.ts)로 돌린다.
// 시작 시도·실제 시작·결과는 요청별 좁은 machine credential로 core command에 남기고, 앱의 보고는 요청별
// app credential(mode=test·진단 scope 고정)로 실제 collector 접수 route에 넘긴다. 돌리지 못한 요청은
// 이유와 함께 끝난다: 조용히 두거나 성공으로 꾸미지 않는다.
//
// 이 모듈은 core graph 밖이다(worker). 요청 credential은 argv·log에 싣지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
  WorkerRequest,
} from "../../../../protocol/supervision/mod.ts";
import {
  type ExecutionEvidence,
  type FrozenTest,
  observeException,
  problemReport,
} from "../../../../protocol/problems/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import {
  blobPurpose,
  buildRecord,
  deriveAppTest,
  OBSERVE_TEST_REQUEST,
  RECOVER_TEST_REQUEST,
  type StoredSideStart,
  TEST_RECOVERY_PRINCIPAL,
  TEST_RUNNER_PRINCIPAL,
  type TestConnection,
  verificationIdFor,
} from "../mod.ts";
import { sha256Hex } from "../../../../base/mod.ts";
import { canonicalHash } from "../canonical.ts";
import { TEST_RUNNER_KIND } from "./runner-core.ts";
import {
  type AppTestHooks,
  type AppTestJob,
  runAppTestJob,
} from "./app-test-run.ts";

const RUNNER_RUN_OP = "problems.test.run";
const RUNNER_RECOVER_OP = "problems.test.recover";

type JobCommon = {
  request_principal: string;
  request_key: string;
  request_hash: string;
  app: string;
  // 접수 기록의 연결(kind·app·target·test와 요청 timeout 등)이다.
  connection: TestConnection;
  // 이 요청에만 닿는 runner machine credential이다.
  credential: string;
  api_port: number;
};

type RunJob = JobCommon & {
  slot: 0 | 1;
  // 앱 보고를 mode=test·진단 scope로 접수하게 하는 요청별 app credential이다.
  report_credential: string;
  diagnostic_scope: string;
};

type RecoverJob = JobCommon & {
  // 이 요청에 지금 묶인 runner. 복구 runner가 이미 이어받았다면 복구 runner다.
  previous_runner: string;
  recovered_at: string | null;
  sides: StoredSideStart[];
};

// core가 돌려받는 끝맺음이다. 정본은 ledger이고 이 값은 core가 다음 일을 정하는 신호일 뿐이다.
type JobOutcome = {
  state:
    | "recorded"
    | "preparation_failed"
    | "not_started"
    | "started_unrecorded"
    | "start_unknown"
    | "runner_lost_recorded";
  reason: string;
  verification?: string;
  result?: string;
};

type LoopbackFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; bytes: Uint8Array }>;

function defaultFetch(): LoopbackFetch {
  return (input, init) => {
    // EXTERNAL_FETCH tripwire: property access로만 부른다.
    const globalFetch = globalThis.fetch;
    return globalFetch(input, init).then(async (response) => ({
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
    }));
  };
}

async function post(
  fetcher: LoopbackFetch,
  port: number,
  credential: string,
  path: string,
  body: unknown,
): Promise<Result<unknown>> {
  let response: { status: number; bytes: Uint8Array };
  try {
    response = await fetcher(`http://127.0.0.1:${port}/v1/problems/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return err({ code: "unavailable", message: "core request failed" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.bytes));
  } catch {
    parsed = undefined;
  }
  if (response.status !== 200) {
    const failure = (parsed as { error?: { code?: string; message?: string } })
      ?.error;
    return err({
      code: (failure?.code ?? "internal") as "internal",
      message: failure?.message ?? `core answered ${response.status}`,
    });
  }
  return ok(parsed);
}

type Client = {
  command(
    method: string,
    input: unknown,
    seed: string,
  ): Promise<Result<Record<string, unknown>>>;
};

async function clientFor(
  job: JobCommon,
  fetcher: LoopbackFetch,
): Promise<Client> {
  const requestKeyHash = (await sha256Hex(job.request_key)).slice(0, 24);
  return {
    async command(method, input, seed) {
      const done = await post(fetcher, job.api_port, job.credential, method, {
        input,
        idempotency_key: `${seed}:${requestKeyHash}`,
        compare: {},
        prepared: [],
      });
      return done.ok ? ok(done.value as Record<string, unknown>) : done;
    },
  };
}

// 앱 보고를 그 요청의 mode=test·진단 scope로 core의 접수 route에 넘긴다. 위치 주장(app·mode·scope)은
// 요청별 app credential에 발급 때 고정돼 있고 본문이 바꾸지 못한다.
function collectorFor(
  fetcher: LoopbackFetch,
  port: number,
  credential: string,
): NonNullable<AppTestHooks["collector"]> {
  const forward = (path: string, body: unknown) =>
    post(fetcher, port, credential, path, body);
  return {
    report: (report) => forward(problemReport.method, report),
    exception: (body) => forward(observeException.method, body),
  };
}

const NOW = () => new Date().toISOString();

function proofOf(
  job: JobCommon,
  phase: "preparation_failed" | "start_attempt" | "start_unknown" | "recovery",
  principals: { machine: string; current: string; next: string | null },
) {
  return {
    machine_principal: principals.machine,
    phase,
    request_principal: job.request_principal,
    request_key: job.request_key,
    request_hash: job.request_hash,
    app: job.app,
    current_runner: principals.current,
    next_runner: principals.next,
    operation: phase === "recovery"
      ? RECOVER_TEST_REQUEST
      : OBSERVE_TEST_REQUEST,
  } as const;
}

type Prepare = ChildSession["prepareBlob"];

// 결과를 ledger에 남긴다: 근거 기록 → 영구 blob 준비 → RecordVerification. blob은 hash가 저장한 bytes의
// sha256과 같을 때만 등록한다(저장하지 않은 blob의 hash를 적지 않는다).
async function recordResult(input: {
  job: JobCommon;
  client: Client;
  prepare: Prepare;
  principal: string;
  derived: { frozen: FrozenTest; blobs: ReadonlyMap<string, Uint8Array> };
  executions: ExecutionEvidence[];
  observations: unknown;
  result: "pass" | "fail" | "inconclusive";
  reason: string;
  sufficient: boolean;
}): Promise<Result<{ verification: string }>> {
  const { job } = input;
  const built = buildRecord({
    id: verificationIdFor(
      job.request_principal,
      job.request_key,
      job.request_hash,
    ),
    request_principal: job.request_principal,
    request_key: job.request_key,
    request_hash: job.request_hash,
    runner_principal: input.principal,
    connection: job.connection,
    frozen: input.derived.frozen,
    executions: input.executions,
    observations: input.observations,
    result: input.result,
    reason: input.reason,
    sufficient: input.sufficient,
  });
  if (!built.ok) return built;
  const staged = await input.client.command("stage-test-evidence", {
    request_principal: job.request_principal,
    request_key: job.request_key,
    request_hash: job.request_hash,
    evidence: built.value.evidence,
  }, "stage");
  if (!staged.ok) {
    return err({
      code: staged.error.code,
      message: `근거 기록: ${staged.error.message}`,
    });
  }
  const contents = new Map([
    ...input.derived.blobs,
    ...built.value.contents,
  ]);
  const blobs: unknown[] = [];
  for (const need of built.value.required) {
    const bytes = contents.get(need.hash);
    if (bytes === undefined) {
      return err({
        code: "internal",
        message: `저장할 blob이 없다: ${need.field}`,
      });
    }
    const prepared = await input.prepare({
      purpose: blobPurpose(need.field),
      sizeBytes: bytes.length,
      bytes,
    });
    if (!prepared.ok) return prepared;
    if (prepared.value.hash !== need.hash) {
      return err({
        code: "internal",
        message: `준비한 blob의 hash가 근거와 다르다: ${need.field}`,
      });
    }
    blobs.push({
      owner_kind: need.owner_kind,
      owner_key: need.owner_key,
      field: need.field,
      registered_seq: "1",
      source: { kind: "prepared", blob: prepared.value },
    });
  }
  const recorded = await input.client.command("record-verification", {
    verification: built.value.verification,
    blobs,
  }, "record");
  if (!recorded.ok) {
    return err({
      code: recorded.error.code,
      message: `결과 기록: ${recorded.error.message}`,
    });
  }
  return ok({ verification: String(recorded.value["verification"]) });
}

const ENVIRONMENT_EVIDENCE = {
  runner_version: "lophn-runner/1",
  output: null,
  output_missing_reason: "runner가 자식 출력을 아직 결과에 싣지 않는다",
  truncated: false,
  redaction_notes: [] as string[],
};

// 접수된 요청 한 건을 시작부터 결과까지 돈다.
async function runRequest(
  job: RunJob,
  session: Pick<ChildSession, "prepareBlob">,
  options: { fetch?: LoopbackFetch; root?: string } = {},
): Promise<JobOutcome> {
  const fetcher = options.fetch ?? defaultFetch();
  const client = await clientFor(job, fetcher);
  const principals = {
    machine: TEST_RUNNER_PRINCIPAL,
    current: TEST_RUNNER_PRINCIPAL,
    next: null,
  };
  const observation = (
    phase: "preparation_failed" | "start_attempt",
    at: string | null,
    reason: string,
  ) =>
    client.command("observe-test-request", {
      observation: {
        phase,
        request_principal: job.request_principal,
        request_key: job.request_key,
        request_hash: job.request_hash,
        at,
        previous_runner: null,
        runner_principal: TEST_RUNNER_PRINCIPAL,
        reason,
      },
      proof: proofOf(job, phase, principals),
    }, phase);
  // 시작 전에 확인한 사실로 실행할 수 없으면 이유를 요청 기록에 남기고 끝낸다. Verification은 만들지 않는다.
  const unrunnable = async (reason: string): Promise<JobOutcome> => {
    const recorded = await observation("preparation_failed", null, reason);
    return recorded.ok ? { state: "preparation_failed", reason } : {
      state: "not_started",
      reason: `${reason} (기록 실패: ${recorded.error.message})`,
    };
  };

  const connection = job.connection;
  if (connection.kind !== "app_test") {
    return await unrunnable(
      `${connection.kind} 요청은 이 runner가 실행하지 않는다`,
    );
  }
  const root = options.root ?? Deno.env.get("LOPHN_HOME") ?? "";
  const bundle =
    `${root}/apps/${job.app}/bundles/${connection.target.bundle_hash}`;
  const derived = await deriveAppTest(bundle, connection.target.bundle_hash);
  if (!derived.ok) return await unrunnable(derived.reason);
  if (derived.value.test_hash !== connection.test) {
    return await unrunnable(
      "요청의 고정 시험 hash가 대상 bundle에서 만든 고정 시험과 다르다",
    );
  }
  const test = derived.value;
  const bundleHash = connection.target.bundle_hash;

  // 시작 시도를 확정한 뒤에만 자식을 띄운다. 이미 시도한 요청이면 거절돼 다시 시작하지 않는다.
  const attempted = await observation("start_attempt", NOW(), "시작 시도");
  if (!attempted.ok) {
    return {
      state: "not_started",
      reason: `시작 시도를 확정하지 못했다: ${attempted.error.message}`,
    };
  }
  const sockets = {
    broker: `${root}/work/problems/tests/sock/${job.slot}-b.sock`,
    control: `${root}/work/problems/tests/sock/${job.slot}-a.sock`,
  };
  const frozenTimeout = test.frozen.method.timeout_ms;
  const jobSpec: AppTestJob = {
    request_key: job.request_key,
    slot: job.slot,
    work: `${root}/work/problems/tests/${
      (await sha256Hex(job.request_key)).slice(0, 24)
    }`,
    sockets,
    bundle,
    bundle_hash: bundleHash,
    test_hash: test.test_hash,
    dependencies_hash: test.frozen.sdk_dependencies ?? "",
    // 접수한 요청은 이전 release의 data schema를 싣지 않는다. 이전 release 없음으로 다루고 이유를 둔다.
    previous_schema: null,
    timeout_ms: frozenTimeout,
    ...(connection.request_timeout_ms === undefined
      ? {}
      : { request_timeout_ms: connection.request_timeout_ms }),
    scope: job.diagnostic_scope,
    deno: Deno.execPath(),
    environment: {
      ...(Deno.env.get("HOME") ? { home: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("DENO_DIR")
        ? { denoDir: Deno.env.get("DENO_DIR")! }
        : {}),
    },
  };
  let sideStartFailure: string | null = null;
  let sideStarted = false;
  const hooks: AppTestHooks = {
    collector: collectorFor(fetcher, job.api_port, job.report_credential),
    // 자식이 실제로 시작한 직후 시작 사실을 ledger에 남긴다. 남기지 못하면 결과를 쓰지 않는다.
    async started(child) {
      sideStarted = true;
      const side = await client.command("start-test-side", {
        start: {
          request_principal: job.request_principal,
          request_key: job.request_key,
          request_hash: job.request_hash,
          side: "single",
          started_at: child.started_at,
          test_hash: test.test_hash,
          bundle_hash: bundleHash,
        },
        proof: proofOf(job, "start_attempt", principals),
      }, "side");
      if (!side.ok) sideStartFailure = side.error.message;
    },
  };
  const ran = await runAppTestJob(jobSpec, hooks);
  if (!ran.ok) {
    // 자식을 띄우기 전에 실패했다면(메모리 경계를 걸 수 없음 등) 실행하지 않은 이유를 요청 기록에 남긴다.
    // 이미 실제로 시작했다면 결과를 쓰지 않고 남긴다: 이어받는 쪽이 runner_lost로 닫는다.
    return sideStarted
      ? {
        state: "started_unrecorded",
        reason: `실행 중 실패했다: ${ran.error.message}`,
      }
      : await unrunnable(`시작하지 못했다: ${ran.error.message}`);
  }
  const { judgment, execution } = ran.value;
  if (sideStartFailure !== null) {
    return {
      state: "started_unrecorded",
      reason: `실제 시작을 기록하지 못했다: ${sideStartFailure}`,
    };
  }
  const mode = execution.mode === "soft" ? "soft" : "hard";
  const executions: ExecutionEvidence[] = [{
    side: "single",
    bundle_hash: bundleHash,
    test_hash: test.test_hash,
    started_at: execution.started_at,
    ended_at: execution.ended_at ?? NOW(),
    exit_code: execution.exit_code,
    end_reason: execution.end_reason === "exited" ||
        execution.end_reason === "timeout" || execution.end_reason === "killed"
      ? execution.end_reason
      : "killed",
    environment: test.environment,
    memory_limit_mode: mode,
    ...ENVIRONMENT_EVIDENCE,
  }];
  const observations = { ...judgment.observations };
  const detailed = {
    ...observations,
    runner: { forwarded: ran.value.forwarded },
  };
  const attempt = async (value: unknown) =>
    await recordResult({
      job,
      client,
      prepare: (blob) => session.prepareBlob(blob),
      principal: TEST_RUNNER_PRINCIPAL,
      derived: test,
      executions,
      observations: value,
      result: judgment.result,
      reason: judgment.reason.trim() === ""
        ? execution.reason
        : judgment.reason,
      sufficient: execution.result !== "inconclusive",
    });
  // 부가 관측이 한도를 넘으면 판정 관측만 싣는다. 한 번 보낸 근거는 바뀌지 않으므로 보내기 전에 정한다.
  let fits = true;
  try {
    canonicalHash(detailed);
  } catch {
    fits = false;
  }
  const recorded = await attempt(fits ? detailed : observations);
  if (!recorded.ok) {
    return {
      state: "started_unrecorded",
      reason:
        `결과를 기록하지 못했다: ${recorded.error.code} ${recorded.error.message}`,
    };
  }
  return {
    state: "recorded",
    reason: judgment.reason,
    verification: recorded.value.verification,
    result: judgment.result,
  };
}

// runner가 바뀐 뒤 이미 시작 시도를 남긴 요청을 이어받는다. 다시 시작하지 않는다. 실제 시작을 관측한
// 요청은 runner_lost inconclusive로, 시작 여부를 모르면 시작 불명으로 남긴다.
async function recoverRequest(
  job: RecoverJob,
  session: Pick<ChildSession, "prepareBlob">,
  options: { fetch?: LoopbackFetch; root?: string } = {},
): Promise<JobOutcome> {
  const fetcher = options.fetch ?? defaultFetch();
  const client = await clientFor(job, fetcher);
  const principal = TEST_RECOVERY_PRINCIPAL;
  const at = job.recovered_at ?? NOW();
  if (job.previous_runner !== principal) {
    const taken = await client.command("observe-test-request", {
      observation: {
        phase: "recovery",
        request_principal: job.request_principal,
        request_key: job.request_key,
        request_hash: job.request_hash,
        at,
        previous_runner: job.previous_runner,
        runner_principal: principal,
        reason:
          "runner_lost: runner가 끝나 이미 시작을 시도한 요청을 이어받는다",
      },
      proof: proofOf(job, "recovery", {
        machine: principal,
        current: job.previous_runner,
        next: principal,
      }),
    }, "recovery");
    if (!taken.ok) {
      return {
        state: "not_started",
        reason: `이어받지 못했다: ${taken.error.message}`,
      };
    }
  }
  const mine = { machine: principal, current: principal, next: null };
  if (job.sides.length === 0) {
    const reason =
      "시작 시도는 남았지만 runner가 끝나 실제 시작을 관측하지 못했다";
    const unknown = await client.command("observe-test-request", {
      observation: {
        phase: "start_unknown",
        request_principal: job.request_principal,
        request_key: job.request_key,
        request_hash: job.request_hash,
        at: null,
        previous_runner: null,
        runner_principal: principal,
        reason,
      },
      proof: proofOf(job, "start_unknown", mine),
    }, "unknown");
    return unknown.ok ? { state: "start_unknown", reason } : {
      state: "not_started",
      reason: `시작 불명을 기록하지 못했다: ${unknown.error.message}`,
    };
  }
  const bundleHash = job.connection.target.bundle_hash;
  const root = options.root ?? Deno.env.get("LOPHN_HOME") ?? "";
  const derived = await deriveAppTest(
    `${root}/apps/${job.app}/bundles/${bundleHash}`,
    bundleHash,
  );
  if (!derived.ok || derived.value.test_hash !== job.connection.test) {
    return {
      state: "started_unrecorded",
      reason:
        "시작한 요청의 고정 시험을 다시 만들 수 없어 결과를 남기지 못했다",
    };
  }
  const test = derived.value;
  const reason =
    "runner_lost: runner가 끝나 이 요청의 실행을 끝까지 관측하지 못했다";
  const side = job.sides[0];
  const executions: ExecutionEvidence[] = [{
    side: "single",
    bundle_hash: side.bundle_hash,
    test_hash: side.test_hash,
    started_at: side.started_at,
    ended_at: at > side.started_at ? at : side.started_at,
    exit_code: null,
    end_reason: "runner_lost",
    environment: test.environment,
    // 끝난 runner가 건 한도 방식은 남아 있지 않다. 더 약한 쪽으로 적는다.
    memory_limit_mode: "soft",
    ...ENVIRONMENT_EVIDENCE,
    output_missing_reason: "runner가 끝나 자식 출력을 거두지 못했다",
  }];
  const recorded = await recordResult({
    job,
    client,
    prepare: (blob) => session.prepareBlob(blob),
    principal,
    derived: test,
    executions,
    observations: {
      runner_lost: {
        previous_runner: job.previous_runner,
        recovered_by: principal,
        sides: job.sides.map((item) => ({
          side: item.side,
          started_at: item.started_at,
        })),
      },
    },
    result: "inconclusive",
    reason,
    sufficient: false,
  });
  if (!recorded.ok) {
    return {
      state: "started_unrecorded",
      reason: `runner_lost 결과를 기록하지 못했다: ${recorded.error.message}`,
    };
  }
  return {
    state: "runner_lost_recorded",
    reason,
    verification: recorded.value.verification,
    result: "inconclusive",
  };
}

type RunnerWorkerOptions = {
  streams: ChildStreams;
  fetch?: LoopbackFetch;
};

function requestOf(message: ParentMessage): WorkerRequest | undefined {
  const record = message as unknown as Record<string, unknown>;
  return record["type"] === "worker_request" &&
      typeof record["request_id"] === "string" &&
      typeof record["op"] === "string"
    ? message as unknown as WorkerRequest
    : undefined;
}

function createRunnerWorker(options: RunnerWorkerOptions): ChildSession {
  let stopped = false;
  const respond = (message: ChildMessage) => session.send(message);
  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== TEST_RUNNER_KIND) {
        throw new Error("invalid worker kind");
      }
      return session.send({ type: "ready" });
    },
    onStop() {
      stopped = true;
      return session.send({ type: "stopped" });
    },
    onParent(message) {
      const request = requestOf(message);
      if (request === undefined) return;
      const op = request.op;
      // 요청은 기다리지 않고 시작한다: 한 요청이 오래 도는 동안에도 다음 frame(blob 준비 credit, 정지)을 읽는다.
      if (op !== RUNNER_RUN_OP && op !== RUNNER_RECOVER_OP) {
        return respond({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: { code: "invalid_input", message: "unknown runner op" },
        });
      }
      const payload = request.payload as RunJob & RecoverJob;
      const work = op === RUNNER_RUN_OP
        ? runRequest(payload, session, { fetch: options.fetch })
        : recoverRequest(payload, session, { fetch: options.fetch });
      void work.then(
        (outcome) =>
          stopped ? undefined : respond({
            type: "worker_response",
            request_id: request.request_id,
            ok: true,
            payload: outcome,
          }),
        () =>
          stopped ? undefined : respond({
            type: "worker_response",
            request_id: request.request_id,
            ok: false,
            error: { code: "internal", message: "runner job failed" },
          }),
      );
    },
  });
  return session;
}

export async function runRunnerService(): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = createRunnerWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
  });
  await session.run();
}
