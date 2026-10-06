// 화면 context와 agent 주석 등록(apps/sdk#R39, apps/agent-context#R1–R5).
//
// 앱은 blueprint에 선언한 read_command·annotation_targets[].write_command의 handler를 이 함수로
// 등록한다. 새 예약 command나 DOM 접근 통로는 없고, 등록한 handler는 일반 command 통로(같은 서명·
// 연결 범위·agent.commands grant)로만 불린다. 선언·민감 path·view session은 앱 코드가 아니라 host
// port(packages/apps/agent-context/host.ts)가 release에 고정된 blueprint와 이 프로세스의 view에서
// 준다. 제거·요약 크기 규칙도 host가 갖고, host가 없으면 원문을 내보내지 않고 거절한다.
//
// 오류 안내 문장에는 화면 상태·입력 값을 넣지 않는다. 앱 provider가 던진 오류 원문도 전하지 않는다.
import { command, currentContext } from "./handlers.ts";
import { CommandRejection } from "./rejection.ts";

// host port 모양. packages/apps/agent-context/host.ts와 같은 symbol·필드다.
const SCREEN_CONTEXT_PORT = Symbol.for("lophn.screen-context");

type DeclaredContext = {
  screen: string;
  read_command: string;
  sensitive_paths: readonly string[];
  annotation_targets: readonly {
    key: string;
    label: string;
    write_command: string;
  }[];
};
type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
type HostReadInput = { screen: string; view_session: string; detail: boolean };
type HostWriteInput = {
  screen: string;
  view_session: string;
  expected_revision: string;
  target: string;
  text: string;
  input: Record<string, unknown>;
};
type HostPrepared = {
  summary: string;
  data?: Record<string, unknown> | null;
  redacted: string[];
};
type ScreenContextHost = {
  declaration(screen: string): DeclaredContext | undefined;
  view(viewSession: string): { screen: string } | undefined;
  parseRead(raw: unknown): Parsed<HostReadInput>;
  parseWrite(raw: unknown): Parsed<HostWriteInput>;
  prepare(input: {
    summary: unknown;
    data?: unknown;
    detail: boolean;
    sensitive_paths: readonly string[];
  }): HostPrepared;
};

function readHost(): ScreenContextHost | undefined {
  const port = (globalThis as Record<symbol, unknown>)[SCREEN_CONTEXT_PORT];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<ScreenContextHost>;
  if (
    typeof candidate.declaration !== "function" ||
    typeof candidate.view !== "function" ||
    typeof candidate.parseRead !== "function" ||
    typeof candidate.parseWrite !== "function" ||
    typeof candidate.prepare !== "function"
  ) return;
  return candidate as ScreenContextHost;
}

function requireHost(): ScreenContextHost {
  const host = readHost();
  if (!host) {
    throw new CommandRejection(
      "unavailable",
      "screen context is not available in this process",
    );
  }
  return host;
}

export type JsonObject = { [key: string]: unknown };

// 한 view session의 현재 상태. revision은 상태가 바뀔 때마다 새 값이다.
export type ScreenViewState = {
  revision: string;
  summary: string;
  // 상세 조회(detail=true)에서만 내보낸다. 민감 칸은 선언한 path로 host가 제거한다.
  data?: JsonObject;
};

export type ScreenContextRegistration = {
  screen: string;
  // blueprint의 agent_context[].read_command key.
  command: string;
  // 앱이 그 view session의 상태를 갖고 있지 않으면(닫힘·모름) undefined를 돌려준다.
  read(request: {
    view_session: string;
    detail: boolean;
  }): ScreenViewState | undefined | Promise<ScreenViewState | undefined>;
  // 주석 쓰기가 비교할 현재 revision. 없으면 read(detail=false)의 revision을 쓴다.
  revision?(
    viewSession: string,
  ): string | undefined | Promise<string | undefined>;
};

export type AnnotationWriteRequest = {
  view_session: string;
  target: string;
  text: string;
  // 사람이 조회한 revision이자 지금 revision(둘이 같을 때만 호출된다).
  revision: string;
  // 업무별 추가 필드를 포함한 command 입력 전체.
  input: Record<string, unknown>;
};

export type AnnotationWriteResult = {
  // 쓰기 뒤의 새 revision.
  revision: string;
  result?: unknown;
};

export type AnnotationTargetRegistration = {
  screen: string;
  target: string;
  // blueprint의 annotation_targets[].write_command key. 여러 target이 한 command를 나눌 수 있다.
  command: string;
  write(
    request: AnnotationWriteRequest,
  ): AnnotationWriteResult | Promise<AnnotationWriteResult>;
};

type Registry = {
  screens: Map<string, Map<string, ScreenContextRegistration>>;
  targets: Map<string, Map<string, Map<string, AnnotationTargetRegistration>>>;
  locks: Map<string, Promise<unknown>>;
};

const REGISTRY = Symbol.for("lophn.screen-context.registry");

function registry(): Registry {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[REGISTRY];
  if (existing && typeof existing === "object") return existing as Registry;
  const created: Registry = {
    screens: new Map(),
    targets: new Map(),
    locks: new Map(),
  };
  store[REGISTRY] = created;
  return created;
}

const MISMATCH = "the screen context declaration does not match this call";

export function registerScreenContext(
  registration: ScreenContextRegistration,
): void {
  const { screens } = registry();
  const existing = screens.get(registration.command);
  if (existing?.has(registration.screen)) {
    throw new Error(
      `screen context already registered: ${registration.screen}`,
    );
  }
  checkDeclared(registration.screen, registration.command, undefined);
  if (existing) {
    existing.set(registration.screen, registration);
    return;
  }
  command(registration.command, (raw) => readScreen(registration.command, raw));
  screens.set(
    registration.command,
    new Map([[registration.screen, registration]]),
  );
}

export function registerAnnotationTarget(
  registration: AnnotationTargetRegistration,
): void {
  const { targets } = registry();
  const byScreen = targets.get(registration.command);
  const byTarget = byScreen?.get(registration.screen);
  if (byTarget?.has(registration.target)) {
    throw new Error(
      `annotation target already registered: ${registration.screen}/${registration.target}`,
    );
  }
  checkDeclared(registration.screen, undefined, registration);
  if (!byScreen) {
    command(
      registration.command,
      (raw) => writeAnnotation(registration.command, raw),
    );
    targets.set(
      registration.command,
      new Map([[
        registration.screen,
        new Map([[registration.target, registration]]),
      ]]),
    );
    return;
  }
  if (byTarget) byTarget.set(registration.target, registration);
  else {byScreen.set(
      registration.screen,
      new Map([[registration.target, registration]]),
    );}
}

// host가 이미 있으면 등록할 때 바로 선언과 맞는지 본다. 앱 코드가 host보다 먼저 load되면 호출할 때 본다.
function checkDeclared(
  screen: string,
  read: string | undefined,
  target: AnnotationTargetRegistration | undefined,
): void {
  const host = readHost();
  if (!host) return;
  const declaration = host.declaration(screen);
  if (
    !declaration ||
    (read !== undefined && declaration.read_command !== read) ||
    (target !== undefined &&
      !declaration.annotation_targets.some((item) =>
        item.key === target.target && item.write_command === target.command
      ))
  ) {
    throw new TypeError(
      `screen context is not declared in the blueprint: ${screen}`,
    );
  }
}

function reject(
  code: "invalid_input" | "conflict" | "unavailable",
  message: string,
): never {
  throw new CommandRejection(code, message);
}

// 앱 provider가 던진 오류는 상태·입력 값을 담을 수 있어 원문 없이 같은 문장으로 바꾼다.
async function fromApp<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return reject("unavailable", "screen state could not be read");
  }
}

function usableView(
  host: ScreenContextHost,
  screen: string,
  viewSession: string,
): void {
  const view = host.view(viewSession);
  // 닫힌 view·모르는 session·접근할 수 없는 session은 같은 답이다.
  if (!view) reject("unavailable", "the screen view is closed or unknown");
  if (view.screen !== screen) reject("invalid_input", MISMATCH);
}

async function readScreen(
  commandKey: string,
  raw: unknown,
): Promise<unknown> {
  const host = requireHost();
  const parsed = host.parseRead(raw);
  if (!parsed.ok) return reject("invalid_input", parsed.message);
  const input = parsed.value;
  const entry = registry().screens.get(commandKey)?.get(input.screen);
  const declaration = host.declaration(input.screen);
  if (!entry || !declaration || declaration.read_command !== commandKey) {
    return reject("invalid_input", MISMATCH);
  }
  usableView(host, input.screen, input.view_session);
  const context = currentContext();
  // 화면 context는 고정된 release의 선언을 따른다. release가 없는 실행은 만들지 않는다.
  if (!context || context.release === null) {
    return reject("unavailable", "screen context needs a live release");
  }
  const state = await fromApp(() =>
    entry.read({ view_session: input.view_session, detail: input.detail })
  );
  if (state === undefined) {
    return reject("unavailable", "the screen view is closed or unknown");
  }
  if (!opaque(state?.revision)) {
    return reject("unavailable", "screen state could not be read");
  }
  const prepared = host.prepare({
    summary: state.summary,
    data: state.data,
    detail: input.detail,
    sensitive_paths: declaration.sensitive_paths,
  });
  return {
    app: context.app,
    release: context.release,
    screen: input.screen,
    view_session: input.view_session,
    revision: state.revision,
    summary: prepared.summary,
    ...(input.detail ? { data: prepared.data ?? null } : {}),
    redacted: prepared.redacted,
  };
}

function opaque(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    !/\p{Cc}/u.test(value);
}

async function currentRevision(
  commandKey: string,
  screen: string,
  viewSession: string,
): Promise<string> {
  const entry = registry().screens.get(commandKey)?.get(screen);
  if (!entry) {
    return reject("unavailable", "the screen view is closed or unknown");
  }
  const revision = await fromApp(async () => {
    if (entry.revision) return await entry.revision(viewSession);
    return (await entry.read({ view_session: viewSession, detail: false }))
      ?.revision;
  });
  if (revision === undefined) {
    return reject("unavailable", "the screen view is closed or unknown");
  }
  if (!opaque(revision)) {
    return reject("unavailable", "screen state could not be read");
  }
  return revision;
}

// 같은 view session의 쓰기는 차례로 처리해 revision 비교와 쓰기 사이에 다른 쓰기가 끼지 않게 한다.
async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const { locks } = registry();
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.then(() => undefined, () => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

async function writeAnnotation(
  commandKey: string,
  raw: unknown,
): Promise<unknown> {
  const host = requireHost();
  const parsed = host.parseWrite(raw);
  if (!parsed.ok) return reject("invalid_input", parsed.message);
  const input = parsed.value;
  const entry = registry().targets.get(commandKey)?.get(input.screen)?.get(
    input.target,
  );
  const declaration = host.declaration(input.screen);
  if (
    !entry || !declaration ||
    !declaration.annotation_targets.some((item) =>
      item.key === input.target && item.write_command === commandKey
    )
  ) return reject("invalid_input", MISMATCH);
  usableView(host, input.screen, input.view_session);
  return await serial(`${input.view_session}`, async () => {
    const current = await currentRevision(
      declaration.read_command,
      input.screen,
      input.view_session,
    );
    if (current !== input.expected_revision) {
      return reject(
        "conflict",
        "the screen changed after it was read; read the current screen again",
      );
    }
    const written = await entry.write({
      view_session: input.view_session,
      target: input.target,
      text: input.text,
      revision: current,
      input: input.input,
    });
    if (!opaque(written?.revision)) {
      throw new Error("annotation write did not return a new revision");
    }
    return { revision: written.revision, result: written.result ?? null };
  });
}
