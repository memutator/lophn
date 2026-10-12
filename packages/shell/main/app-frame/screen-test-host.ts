// 앱 화면 검사 host. problems runner가 같은 실행 파일을
// `--app-screen-test`로 띄우면 상속 fd 3에서 입력 한 줄을 읽고, 고정 bundle의 화면을 test view에
// 하나씩 열어 load·처리되지 않은 오류·깨진 view의 feedback 경로·막힌 network 시도를 관측한 뒤
// 관측 한 줄을 같은 fd에 쓰고 끝난다. 사람 token·core·collector·운영 view session·DB는 쓰지
// 않는다. 관측을 collector로 넘기는 것은 runner다. Electron 조립은
// `entry-screen-test.ts`에 있고 여기는 순서·관측·bundle 파일 응답만 둔다. 입력·관측 schema는
// contracts/shell `screen-test.ts`이고, shell tsc가 contracts 원본을 검사하지 못해 deno가
// 검사하는 entry가 schema로 입력을 거르고 관측을 확인한다. 여기 타입은 그 모양과 같다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, sep } from "node:path";
import { Readable } from "node:stream";

import { type CallOutcome, outcomeOf } from "./app-call.ts";
import type { Invoker } from "./app-invoke.ts";
import type { Upstream, UpstreamResponse } from "./app-protocol.ts";
import { SCREEN_TEST_PROBE_SCRIPTS } from "../../ipc/screen-test.ts";
import { APP_SCHEME } from "./network-policy.ts";
import { checkViewError } from "./view-error.ts";

/** 통로 frame 하나의 상한. 입력·관측 모두 이 안이다. */
export const FRAME_MAX_BYTES = 65_536;
/** load 뒤 늦게 오는 오류(timer·rejection)를 기다리는 시간. */
export const SETTLE_MS = 1_000;
/** feedback 캡처·dialog를 기다리는 한계. 운영 feedback의 캡처 대기와 같다(architecture/shell 7.4). */
export const FEEDBACK_MS = 1_500;
/** 일부러 멈춘 renderer가 응답하지 않는지 기다리는 시간. */
export const BLOCK_RESPONSE_MS = 500;
// 관측 frame이 상한 안에 머물게 하는 화면당 상한.
export const ERRORS_PER_SCREEN = 20;
export const BLOCKED_PER_SCREEN = 32;
export const ERROR_MESSAGE_MAX_CHARS = 1_024;

/** test view의 앱 신원. 실제 앱 ID가 아니며 host label은 `app-test`다(운영 label은 ULID다). */
export const SCREEN_TEST_APP = "app_test";
export const SCREEN_TEST_LABEL = "app-test";

/** 실행마다 새 메모리 partition. `persist:`가 없어 디스크에 남지 않고 운영 partition과 겹치지 않는다. */
export function screenTestPartition(run: string): string {
  return `app-test-${run}`;
}

export interface ScreenEntry {
  key: string;
  path: string;
}

/** contracts/shell screenTestInputSchema가 통과시킨 입력. */
export interface ScreenTestInput {
  bundle_screens_dir: string;
  screens: readonly ScreenEntry[];
  app_socket_path: string;
  deadline_ms: number;
  /** 있으면 화면마다 오류 probe를 일으키고 첫 화면을 일부러 멈춘다. */
  probe_nonce?: string;
}

type ViewErrorKind = "error" | "unhandledrejection" | "render_error";

/** contracts/shell screenTestObservationSchema의 모양. */
export interface ScreenTestObservation {
  load: { screen: string; ok: boolean; reason: string | null }[];
  errors: {
    screen: string;
    observation: ViewErrorKind;
    name: string;
    message: string | null;
  }[];
  feedback_check: ({ screen: string; induced?: boolean } & FeedbackResult)[];
  blocked_requests: { screen: string; url_hash: string }[];
}

/** view가 처음 여는 주소. 화면 파일 이름만 싣고 나머지 자원은 같은 폴더 기준이다. */
export function screenEntryUrl(screen: ScreenEntry): string {
  return `${APP_SCHEME}://${SCREEN_TEST_LABEL}/${
    encodeURIComponent(screen.key)
  }/${encodeURIComponent(basename(screen.path))}`;
}

// ── fd 3 JSON lines ─────────────────────────────────────────────────────────

export interface FrameSource {
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeAllListeners(event: string): unknown;
}

/** 첫 줄을 읽는다. 상한을 넘거나 줄이 끝나기 전에 닫히면 undefined다. */
export function readFrame(
  source: FrameSource,
  max = FRAME_MAX_BYTES,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const parts: Uint8Array[] = [];
    let size = 0;
    const done = (value: string | undefined) => {
      for (const event of ["data", "end", "close", "error"]) {
        source.removeAllListeners(event);
      }
      resolve(value);
    };
    source.on("data", (chunk) => {
      const newline = chunk.indexOf(10);
      const piece = newline < 0 ? chunk : chunk.subarray(0, newline);
      size += piece.byteLength;
      if (size > max) return done(undefined);
      parts.push(piece);
      if (newline >= 0) done(Buffer.concat(parts).toString("utf8"));
    });
    source.on("end", () => done(undefined));
    source.on("close", () => done(undefined));
    source.on("error", () => done(undefined));
  });
}

/** 관측 한 줄이 frame 상한 안인가. 넘으면 쓰지 않는다(runner는 관측 없음을 판정 불가로 둔다). */
export function fitsFrame(line: string): boolean {
  return Buffer.byteLength(line) <= FRAME_MAX_BYTES;
}

// ── 관측 ────────────────────────────────────────────────────────────────────

export interface FeedbackResult {
  binding: boolean;
  capture: "captured" | "missing";
  dialog: "opened" | "blocked";
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createScreenTestRecorder() {
  const observation: ScreenTestObservation = {
    load: [],
    errors: [],
    feedback_check: [],
    blocked_requests: [],
  };
  const counted = (list: readonly { screen: string }[], screen: string) =>
    list.filter((item) => item.screen === screen).length;
  return {
    load(screen: string, ok: boolean, reason: string | null): void {
      observation.load.push({ screen, ok, reason });
    },
    /** 설치 preload의 `app:view-error` 본문. 모르는 모양은 버린다. 원문 message는 잘라 싣는다. */
    error(screen: string, value: unknown): void {
      const checked = checkViewError(value);
      if (
        checked === undefined ||
        counted(observation.errors, screen) >= ERRORS_PER_SCREEN
      ) {
        return;
      }
      observation.errors.push({
        screen,
        observation: checked.observation,
        name: checked.name,
        message: checked.message?.slice(0, ERROR_MESSAGE_MAX_CHARS) ?? null,
      });
    },
    /** 막힌 요청은 주소의 hash만 남긴다(query의 값이 관측에 실리지 않게). */
    blocked(screen: string, url: string): void {
      if (counted(observation.blocked_requests, screen) >= BLOCKED_PER_SCREEN) {
        return;
      }
      observation.blocked_requests.push({ screen, url_hash: sha256(url) });
    },
    feedback(
      screen: string,
      result: FeedbackResult,
      induced = false,
    ): void {
      observation.feedback_check.push({
        screen,
        ...result,
        ...(induced ? { induced: true } : {}),
      });
    },
    observation(): ScreenTestObservation {
      return structuredClone(observation);
    },
  };
}

export type ScreenTestRecorder = ReturnType<typeof createScreenTestRecorder>;

// ── 순서 ────────────────────────────────────────────────────────────────────

export type LoadResult = { ok: true } | { ok: false; reason: string };

/** 열린 test view 하나. Electron adapter가 만든다. */
export interface ScreenSurface {
  loaded: Promise<LoadResult>;
  /** 버튼 시점의 binding. view가 살아 있고 main frame이 아직 그 화면 주소다. */
  bound(): boolean;
  /** ms 안에 새 frame을 얻으면 true다. 멈춘·죽은 view는 false다. */
  capture(ms: number): Promise<boolean>;
  /** 화면에 오류 probe script(error·unhandledrejection·render-error)를 붙인다. */
  probe?(): void;
  /**
   * 페이지 main thread를 막고 renderer가 응답하지 않게 됐는지 돌려준다. offscreen은 멈춘
   * renderer에서도 마지막 frame을 다시 주므로 캡처 결과로는 멈춤을 알 수 없다.
   */
  block?(): Promise<boolean>;
  close(): void;
}

export interface ScreenTestPorts {
  open(screen: ScreenEntry): ScreenSurface;
  /** 앱 view와 다른 renderer에 feedback dialog 자리를 ms 안에 열면 true다. */
  openDialog(ms: number): Promise<boolean>;
  wait(ms: number): Promise<void>;
  now(): number;
}

function within<T>(
  ports: ScreenTestPorts,
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([promise, ports.wait(ms).then(() => fallback)]);
}

/**
 * 화면을 하나씩 연다. 남은 기한을 남은 화면 수로 나눠 한 화면이 멈춰도 다음 화면을 본다.
 * 기한이 지난 화면은 열지 않고 `deadline`으로 남긴다. 깨진 화면(load 실패·멈춤)도 feedback
 * 경로를 본다.
 */
export async function runScreenTest(
  input: ScreenTestInput,
  ports: ScreenTestPorts,
  recorder: ScreenTestRecorder,
): Promise<void> {
  const end = ports.now() + input.deadline_ms;
  // 첫 번째로 load된 화면 하나만 일부러 멈춘다. 나머지 화면은 온전한 채로 feedback을 본다.
  let blocked = false;
  for (const [index, screen] of input.screens.entries()) {
    const left = end - ports.now();
    if (left <= 0) {
      recorder.load(screen.key, false, "deadline");
      continue;
    }
    const budget = left / (input.screens.length - index);
    const surface = ports.open(screen);
    try {
      const loaded = await within(
        ports,
        surface.loaded,
        Math.max(0, budget - SETTLE_MS - FEEDBACK_MS),
        { ok: false, reason: "timeout" } as LoadResult,
      );
      recorder.load(screen.key, loaded.ok, loaded.ok ? null : loaded.reason);
      if (loaded.ok && input.probe_nonce !== undefined) {
        surface.probe?.();
      }
      await ports.wait(
        Math.max(0, Math.min(SETTLE_MS, budget - FEEDBACK_MS)),
      );
      let induce = false;
      if (
        loaded.ok && input.probe_nonce !== undefined && !blocked &&
        surface.block !== undefined
      ) {
        blocked = true;
        induce = await surface.block();
      }
      const bound = surface.bound();
      const ms = Math.min(FEEDBACK_MS, budget);
      const [captured, opened] = await Promise.all([
        bound ? surface.capture(ms) : Promise.resolve(false),
        ports.openDialog(ms),
      ]);
      recorder.feedback(screen.key, {
        binding: bound,
        capture: captured ? "captured" : "missing",
        dialog: opened ? "opened" : "blocked",
      }, induce);
    } finally {
      surface.close();
    }
  }
}

// ── bundle 파일 응답 ────────────────────────────────────────────────────────

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const NOT_FOUND: UpstreamResponse = { status: 404, headers: {}, body: null };

/**
 * 운영 앱 socket의 `/screens/<key>/…` 대신 고정 bundle 화면 폴더의 파일을 돌려준다. protocol
 * handler(`app-protocol.ts`)가 경로 마디·CSP·MIME을 운영과 똑같이 검사한 뒤 부른다. 화면
 * 파일이 있는 폴더 밖(symlink 포함)과 모르는 확장자는 404다.
 */
/** host가 화면 origin에서 내주는 probe script. nonce는 runner가 준 값이고 오류 message에 든다. */
export function probeScript(
  name: string,
  nonce: string | undefined,
): string | undefined {
  if (nonce === undefined) return undefined;
  const text = (kind: string) => JSON.stringify(`lophn-probe:${nonce}:${kind}`);
  if (name === SCREEN_TEST_PROBE_SCRIPTS.errors) {
    return `setTimeout(() => { throw new Error(${text("error")}); }, 0);
Promise.reject(new TypeError(${text("unhandledrejection")}));
dispatchEvent(new CustomEvent("lophn:render-error", { detail: { name: "RenderError", message: ${
      text("render_error")
    } } }));
`;
  }
  if (name === SCREEN_TEST_PROBE_SCRIPTS.block) {
    return "setTimeout(() => { for (;;) {} }, 0);\n";
  }
  return undefined;
}

export function bundleUpstream(input: ScreenTestInput): Upstream {
  return async (request) => {
    const parts = new URL(request.path, "http://screen.invalid").pathname
      .split("/").slice(1).map(decodeURIComponent);
    const [prefix, key, ...asset] = parts;
    const screen = input.screens.find((item) => item.key === key);
    if (prefix !== "screens" || screen === undefined || asset.length === 0) {
      return NOT_FOUND;
    }
    const probe = asset.length === 1
      ? probeScript(asset[0]!, input.probe_nonce)
      : undefined;
    if (probe !== undefined) {
      return {
        status: 200,
        headers: { "content-type": "text/javascript; charset=utf-8" },
        body: new Blob([probe]).stream(),
      };
    }
    let root: string;
    let file: string;
    try {
      root = await realpath(input.bundle_screens_dir);
      file = await realpath(join(root, dirname(screen.path), ...asset));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
        return NOT_FOUND;
      }
    } catch {
      return NOT_FOUND;
    }
    const type = MEDIA_TYPES[extname(file).toLowerCase()];
    if (type === undefined) return NOT_FOUND;
    const stream = createReadStream(file);
    request.signal.addEventListener("abort", () => stream.destroy(), {
      once: true,
    });
    return {
      status: 200,
      headers: { "content-type": type },
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  };
}

// ── app:call ────────────────────────────────────────────────────────────────

// IPC 입력 상한. app-call.ts의 CALL_INPUT_MAX_BYTES와 같다.
const CALL_INPUT_MAX_BYTES = 64 * 1024;

/**
 * test view의 `lophnApp.call`을 runner가 준 test 앱 socket의 고정 invoke 경로로 보낸다. 사람
 * 연결·blueprint·confirm은 없다. 입력 검사는 test 앱 runtime이 한다. 응답 판정은 운영과 같다.
 */
export function createScreenTestCall(deps: {
  endpoint: string;
  invoke: Invoker;
  requestKey(): string;
}) {
  return async (value: unknown): Promise<CallOutcome<unknown>> => {
    const body = typeof value === "object" && value !== null
      ? value as { command?: unknown; input?: unknown }
      : {};
    let size = Infinity;
    try {
      size = Buffer.byteLength(JSON.stringify(value) ?? "");
    } catch {
      // 직렬화할 수 없는 입력은 아래에서 거절한다.
    }
    if (
      typeof body.command !== "string" || body.command.length === 0 ||
      size > CALL_INPUT_MAX_BYTES
    ) {
      return {
        ok: false,
        error: { code: "invalid_input", message: "command is not available" },
      };
    }
    try {
      return outcomeOf(
        await deps.invoke({
          endpoint: deps.endpoint,
          authorization: "",
          body: {
            request_key: deps.requestKey(),
            command: body.command,
            ...(body.input === undefined ? {} : { input: body.input }),
          },
        }),
      );
    } catch {
      return {
        ok: false,
        error: { code: "unavailable", message: "app is not available" },
      };
    }
  };
}
