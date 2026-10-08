// MCP·CLI의 production credential provider다(coding-agent/connection#R17, R9,
// mcp-server#R36). connection 참조로 시작할 때 platform의 helper `lophn-credential`을
// stdin `CredentialDeliveryRequest`(purpose `mcp_cli_loader`)로 불러 token을 한 번 받는다.
// helper가 core의 소유자 전용 socket에서 active connection·현재 scope·등록된 child(process
// generation·loader identity)·keychain 값을 모두 확인한 응답만 stdout `{"token"}`(종료 0)
// 또는 `{"reason"}`(종료 1)로 낸다. 이 module은 keychain을 열지 않고 token을 판정하지 않는다.
//
// 지키는 것:
// - token은 helper의 stdout에서 이 process의 메모리로만 온다. 설정·파일·환경 변수·argv·진단·
//   오류에 쓰지 않는다. 실패 오류에는 계약의 네 이유(locked·no_secret_service·timeout·not_found)
//   하나만 있고 helper의 출력·경로·connection 값을 싣지 않는다.
// - 평문 파일·user credential fallback·자동 재발급이 없다. 실패는 그대로 unavailable이다.
// - 회수 확인은 core의 매 요청 hash 검사이고 loader를 다시 읽지 않는다. 그래서 성공한 token은
//   process 수명 동안 메모리에 두고 helper를 다시 부르지 않는다. 실패는 두지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  CREDENTIAL_DELIVERY_FAILURES,
  CREDENTIAL_DELIVERY_TIMEOUT_MS,
  type CredentialDeliveryFailure,
  credentialDeliveryRequestSchema,
  credentialDeliveryResponseSchema,
} from "../../../contracts/coding-agent/mod.ts";
import type { ConnectionCredential, CredentialProvider } from "./provider.ts";

// helper를 실행한 결과다. 정상 종료가 아니면 exitCode가 null이거나 0이 아니다.
export type HelperRun = {
  exitCode: number | null;
  stdout: Uint8Array;
};

// helper 실행 port다. 기본은 Deno.Command이고 시험이 fake를 끼운다. 실행하지 못하면 throw한다.
export type HelperRunner = (
  helper: string,
  stdin: Uint8Array,
  signal: AbortSignal,
) => Promise<HelperRun>;

const STDOUT_LIMIT = 4096;

// helper는 `--allow-run=<이 절대 경로>` 하나로만 부른다. 인자·shell 없이 stdin으로만 요청을 준다.
export const denoHelperRunner: HelperRunner = async (
  helper,
  stdin,
  signal,
) => {
  const child = new Deno.Command(helper, {
    args: [],
    stdin: "piped",
    stdout: "piped",
    // helper의 stderr는 진단에 쓰지 않는다. 읽지도 남기지도 않는다.
    stderr: "null",
  }).spawn();
  const kill = () => {
    try {
      child.kill("SIGKILL");
    } catch { /* 이미 끝났다 */ }
  };
  signal.addEventListener("abort", kill, { once: true });
  try {
    const writer = child.stdin.getWriter();
    await writer.write(stdin);
    await writer.close();
    const out = await readLimited(child.stdout, STDOUT_LIMIT);
    const status = await child.status;
    return { exitCode: status.code, stdout: out };
  } finally {
    signal.removeEventListener("abort", kill);
    kill();
  }
};

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("helper output too large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// 이 process의 generation 값이다. 신뢰 감독이 같은 process를 `<pid>.<시작 tick>`로 관측해
// `registerChild`에 등록한다(platform/identity#R15). 시작 tick을 읽지 못하면 pid만이다.
export function processGenerationOf(
  pid: number,
  startTicks: string | undefined,
): string {
  return startTicks === undefined ? `${pid}` : `${pid}.${startTicks}`;
}

// /proc/<pid>/stat의 starttime(22번째 field)이다. comm이 괄호 안이라 마지막 `)` 뒤에서 센다.
export function startTicksOf(stat: string): string | undefined {
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const fields = stat.slice(close + 2).split(" ");
  // `)` 뒤 첫 field가 state(3번째)라서 starttime은 그 뒤 19번째다.
  const value = fields[19];
  return value !== undefined && /^\d+$/.test(value) ? value : undefined;
}

export async function currentProcessGeneration(): Promise<string> {
  try {
    return processGenerationOf(
      Deno.pid,
      startTicksOf(await Deno.readTextFile("/proc/self/stat")),
    );
  } catch {
    return processGenerationOf(Deno.pid, undefined);
  }
}

export type HelperProviderOptions = {
  // 설치 묶음의 helper 절대 경로다. 이 값이 loader identity이기도 하다.
  helper: string;
  generation?: () => string | Promise<string>;
  run?: HelperRunner;
  timeoutMs?: number;
  // not_found만 다시 묻는 한도다(기본 100ms 간격, 총 3초). 신뢰 감독이 TUI 아래 process를 관측해 등록하는
  // 데 걸리는 짧은 틈 때문이다. 그 밖의 답(locked·no_secret_service·timeout·거절)은 바로 실패다. 0이면
  // 다시 묻지 않는다.
  retry?: { intervalMs: number; boundMs: number };
  // 다시 묻는 사이의 기다림과 시계다. 시험이 끼운다.
  clock?: { now(): number; sleep(ms: number): Promise<void> };
};

const NOT_FOUND_RETRY = { intervalMs: 100, boundMs: 3_000 };
const realClock = {
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

function failureOf(value: unknown): CredentialDeliveryFailure {
  const reason = (value as { reason?: unknown } | null)?.reason;
  const found = CREDENTIAL_DELIVERY_FAILURES.find((item) => item === reason);
  return found ?? "not_found";
}

export function createHelperCredentialProvider(
  options: HelperProviderOptions,
): CredentialProvider {
  const run = options.run ?? denoHelperRunner;
  const generation = options.generation ?? currentProcessGeneration;
  const timeoutMs = options.timeoutMs ?? CREDENTIAL_DELIVERY_TIMEOUT_MS;
  const retry = options.retry ?? NOT_FOUND_RETRY;
  const clock = options.clock ?? realClock;
  // 성공한 connection의 token이다. 이 process의 메모리에만 있다.
  const held = new Map<string, ConnectionCredential>();
  const inflight = new Map<
    string,
    Promise<Result<ConnectionCredential, CredentialDeliveryFailure>>
  >();

  async function load(
    connection: string,
  ): Promise<Result<ConnectionCredential, CredentialDeliveryFailure>> {
    // helper 경로가 절대 경로가 아니면 loader identity가 성립하지 않는다.
    if (!options.helper.startsWith("/")) return err("no_secret_service");
    const request = credentialDeliveryRequestSchema.safeParse({
      connection,
      process_generation: await generation(),
      loader_identity: options.helper,
      purpose: "mcp_cli_loader",
    });
    // connection 참조가 올바르지 않으면 helper를 부르지 않는다. core의 범위 밖 답과 같다.
    if (!request.success) return err("not_found");
    // 등록 전이라 not_found인 동안만 한도 안에서 다시 묻는다. 다른 답은 바로 돌려준다.
    const deadline = clock.now() + retry.boundMs;
    let result = await exchangeOnce(request.data);
    while (
      !result.ok && result.error === "not_found" && clock.now() < deadline
    ) {
      await clock.sleep(retry.intervalMs);
      result = await exchangeOnce(request.data);
    }
    return result;
  }

  async function exchangeOnce(
    data: unknown,
  ): Promise<Result<ConnectionCredential, CredentialDeliveryFailure>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });
    const body = new TextEncoder().encode(JSON.stringify(data));
    const exchange = run(options.helper, body, controller.signal).then(
      (outcome) => outcome,
      () => "unrunnable" as const,
    );
    try {
      const outcome = await Promise.race([exchange, timeout]);
      if (outcome === "timeout") return err("timeout");
      // helper 파일이 없거나 실행할 수 없다: 전달 통로가 없다.
      if (outcome === "unrunnable") return err("no_secret_service");
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(outcome.stdout));
      } catch {
        return err("not_found");
      }
      if (outcome.exitCode === 0) {
        const token = credentialDeliveryResponseSchema.safeParse(parsed);
        return token.success
          ? ok({ token: token.data.token })
          : err("not_found");
      }
      return err(failureOf(parsed));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      body.fill(0);
    }
  }

  return (connection) => {
    const have = held.get(connection);
    if (have !== undefined) return Promise.resolve(ok(have));
    const pending = inflight.get(connection);
    if (pending !== undefined) return pending;
    const started = load(connection).then((result) => {
      if (result.ok) held.set(connection, result.value);
      return result;
    }).finally(() => {
      inflight.delete(connection);
    });
    inflight.set(connection, started);
    return started;
  };
}

// 받은 token을 이 process의 알려진 값 registry에 올린다. 실패 진단·MCP text·stderr가 거치는 redaction이
// 이 값을 가리게 해 token이 어떤 출력에도 나오지 않게 한다(connection#R17). registry는 호출 조립이
// 준다(platform redaction의 registry와 같은 `register`).
export function registeringProvider(
  provider: CredentialProvider,
  known: { register(values: readonly string[]): void },
): CredentialProvider {
  return async (connection) => {
    const result = await provider(connection);
    if (result.ok) known.register([result.value.token]);
    return result;
  };
}
