import type { Clock, ErrorCode, Result } from "../../base/mod.ts";
import { err, ok } from "../../base/mod.ts";
import { controlConnect, controlIdentify, controlStop } from "./control.ts";
import {
  CORE_CONTROL_PROTOCOL_VERSION,
  type ControlClient,
  type ControlIdentify,
  type StartFailureReason,
} from "../supervision/core-control.ts";

// detached로 띄운 core의 stdout 첫 JSON 줄 하나. token은 그 줄에 없다.
// stream과 child 참조는 이 줄을 읽은 뒤 놓는다. stderr는 읽지 않고 버린다.
export type DetachedStart =
  | { outcome: "ready" }
  | { outcome: "start_failed"; reason: StartFailureReason }
  | { outcome: "unavailable" };

export type SpawnDetached = (options: {
  // 첫 줄이 이 시간 안에 오지 않으면 unavailable이다.
  timeoutMs: number;
}) => Promise<DetachedStart>;

export type EnsureTimer = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

export type EnsureDeps = {
  // core socket 한 줄 왕복. socket 경로는 shell main·CLI adapter가 정한다.
  dial: (request: string, timeoutMs: number) => Promise<Result<string>>;
  spawnDetached: SpawnDetached;
  clock: Clock;
  timer: EnsureTimer;
  // identify 한 번의 기한.
  requestMs?: number;
  // detached core의 첫 줄을 기다리는 시간.
  startupMs?: number;
  // core가 ready가 되기를 기다리는 시간.
  readyMs?: number;
  // 판이 다른 core를 멈춘 뒤 identify가 사라지기를 기다리는 시간.
  stopMs?: number;
  // identify를 다시 묻는 간격.
  pollMs?: number;
};

export type EnsureOptions = {
  client: ControlClient;
  // root package.json의 판. identify가 알린 판과 다르면 core를 한 번 갈아 띄운다.
  productVersion: string;
};

export type EnsuredCore = {
  api_url: string;
  core_epoch: string;
  user_token: string;
  // `client: shell`일 때만 있다. 받은 main 메모리에만 둔다.
  shell_capability?: string;
};

export type EnsureFailure = {
  code: ErrorCode;
  message: string;
  // core가 시작하지 못한 이유(`START_FAILURE_REASONS`). 그 밖의 실패에는 없다.
  reason?: StartFailureReason;
};

const STARTUP_MS = 30_000;
const READY_MS = 60_000;
const STOP_MS = 15_000;
const POLL_MS = 100;

function unavailable(message: string): EnsureFailure {
  return { code: "unavailable", message };
}

function requestDeps(deps: EnsureDeps) {
  return { dial: deps.dial, timeoutMs: deps.requestMs };
}

function sleep(deps: EnsureDeps, ms: number): Promise<void> {
  // shell main은 ES2023으로 컴파일해 Promise.withResolvers를 쓸 수 없다.
  return new Promise((resolve) => {
    deps.timer.setTimeout(resolve, ms);
  });
}

function matches(identified: ControlIdentify, productVersion: string): boolean {
  return (
    identified.product_version === productVersion &&
    identified.protocol_version === CORE_CONTROL_PROTOCOL_VERSION
  );
}

// starting·stopping인 core가 ready가 되기를 기다린다. 답이 사라져도 기한까지 다시 묻는다.
async function waitReady(
  deps: EnsureDeps,
  timeoutMs: number,
  first?: ControlIdentify,
): Promise<Result<ControlIdentify, EnsureFailure>> {
  const deadline = deps.clock.nowMs() + timeoutMs;
  let current: Result<ControlIdentify> =
    first === undefined ? await controlIdentify(requestDeps(deps)) : ok(first);
  for (;;) {
    if (
      current.ok &&
      current.value.state === "ready" &&
      current.value.api_url !== null
    ) {
      return current;
    }
    if (deps.clock.nowMs() >= deadline) {
      return err(unavailable("core가 준비되지 않았다"));
    }
    await sleep(deps, deps.pollMs ?? POLL_MS);
    current = await controlIdentify(requestDeps(deps));
  }
}

// stop을 보낸 core가 identify에 답하지 않을 때까지 기다린다. lock이 풀렸는지는 다음 시작이 가른다.
async function waitGone(
  deps: EnsureDeps,
): Promise<Result<null, EnsureFailure>> {
  const deadline = deps.clock.nowMs() + (deps.stopMs ?? STOP_MS);
  for (;;) {
    const seen = await controlIdentify(requestDeps(deps));
    // 답이 사라졌으면 core가 끝난 것이다.
    if (!seen.ok) return seen.error.code === "unavailable" ? ok(null) : seen;
    if (deps.clock.nowMs() >= deadline) {
      return err(unavailable("core가 끝나지 않았다"));
    }
    await sleep(deps, deps.pollMs ?? POLL_MS);
  }
}

async function connectReady(
  deps: EnsureDeps,
  options: EnsureOptions,
): Promise<Result<EnsuredCore, EnsureFailure>> {
  const connected = await controlConnect(requestDeps(deps), options.client);
  if (!connected.ok) return connected;
  const value = connected.value;
  // capability는 shell connect에서만 나온다. 반대 방향도 계약 위반이다.
  if (
    options.client === "shell"
      ? value.shell_capability === undefined
      : value.shell_capability !== undefined
  ) {
    return err({
      code: "internal",
      message: "connect 결과의 shell capability가 client와 다르다",
    });
  }
  return ok({
    api_url: value.api_url,
    core_epoch: value.core_epoch,
    user_token: value.user_token,
    ...(value.shell_capability === undefined
      ? {}
      : { shell_capability: value.shell_capability }),
  });
}

// core가 없으면 한 번 띄우고 붙는다. 동시에 띄운 둘 중 진 쪽은 lock에서 conflict로 끝나고
// ensure는 identify를 다시 물어 이긴 core에 합류한다.
async function startAndJoin(
  deps: EnsureDeps,
  options: EnsureOptions,
): Promise<Result<EnsuredCore, EnsureFailure>> {
  const started = await deps.spawnDetached({
    timeoutMs: deps.startupMs ?? STARTUP_MS,
  });
  // schema 실패만 그대로 알린다. `other`는 동시에 띄운 다른 core가 lock을 잡은 경우일 수 있어
  // identify로 합류를 본다.
  if (started.outcome === "start_failed" && started.reason !== "other") {
    return err({
      code: "unavailable",
      message: "core가 시작하지 못했다",
      reason: started.reason,
    });
  }
  const ready = await waitReady(deps, deps.readyMs ?? READY_MS);
  if (!ready.ok) return ready;
  if (!matches(ready.value, options.productVersion)) {
    return err(unavailable("core 판이 다르다"));
  }
  return connectReady(deps, options);
}

export async function ensureCore(
  deps: EnsureDeps,
  options: EnsureOptions,
): Promise<Result<EnsuredCore, EnsureFailure>> {
  const first = await controlIdentify(requestDeps(deps));
  if (first.ok) {
    if (first.value.state === "stopping") {
      const gone = await waitGone(deps);
      if (!gone.ok) return gone;
      return startAndJoin(deps, options);
    }
    const ready = await waitReady(deps, deps.readyMs ?? READY_MS, first.value);
    if (!ready.ok) return ready;
    if (matches(ready.value, options.productVersion)) {
      return connectReady(deps, options);
    }
    // 판이 다르면 한 번만 멈추고 새로 띄운다. 돌던 run을 다시 시작하지는 않는다.
    const stopped = await controlStop(requestDeps(deps));
    // 그 사이 core가 이미 끝나고 있을 수 있다. 그때는 사라지기를 기다리기만 한다.
    if (!stopped.ok && stopped.error.code !== "unavailable") return stopped;
    const gone = await waitGone(deps);
    if (!gone.ok) return gone;
    return startAndJoin(deps, options);
  }
  if (first.error.code !== "unavailable") return first;
  return startAndJoin(deps, options);
}
