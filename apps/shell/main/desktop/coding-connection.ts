// coding agent 연결 화면의 main 쪽(shell#T50, shell/desktop#R19). renderer는 "이 harness로 연결"이라는 고정
// intent와 사람이 고른 harness·이름·범위만 보내고, 이 모듈이 그 intent를 따로 다시 검사한다: 모양, 지금
// 감지된 harness인지, 앱 하나 범위면 그 앱의 source 폴더가 있는지. 설치 target(환경·profile·경로)은 main이
// 감지 기록과 앱 기록에서 만들고 renderer가 보낸 값은 쓰지 않는다.
//
// 연결 생성은 core의 `connect` memory route(사람 credential, 확인 창 없음)이고 token은 이 모듈을 지나지
// 않는다. 이어서 `lophn connection install`로 선택 target만 설치하고 `lophn doctor`로 loading을 읽는다
// (순서는 coding-agent `connectAndInstall`과 같다). 설치·doctor가 실패해도 이미 만든 연결을 회수하거나
// 다시 발급하지 않고 따로 알린다. 감지는 `harness detect`가 저장 결과를, `harness refresh`만 사람 요청
// 재감지를 먹는다(화면이 열릴 때 자동 재감지는 없다).
import { execFile } from "node:child_process";
import { z } from "zod";

import {
  type CodingFailureCode,
  type CodingReply,
  type ConnectRequest,
  connectRequestSchema,
  type ConnectView,
  type DetectView,
  HARNESS_IDS,
  type HarnessView,
  type InstallStatus,
} from "../../ipc/coding.ts";

// shell main은 contracts를 따라가지 않는다(shell tsc). 이 모듈이 읽는 감지·연결 값의 모양만 여기 둔다. 값은
// contracts coding-agent의 harnessDetectionSchema·connectionIdSchema와 같아야 하고
// terminal/coding/coding-ipc_test.ts가 실제 schema의 값이 이 모양을 통과하는지 본다.
const connectionIdSchema = z.string().regex(/^cac_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

export const detectionSchema = z.object({
  harness_id: z.enum(HARNESS_IDS),
  environment: z.object({
    kind: z.enum(["host", "wsl", "remote"]),
    identity: z.string().min(1),
  }),
  profile_id: z.string().min(1).nullable(),
  observed_at: z.string().min(1),
  discovery: z.enum(["unobserved", "detected", "absent", "unknown", "error"]),
  candidates: z.array(z.object({
    path: z.string().min(1),
    source: z.string().min(1),
  })),
  selected_executable: z.string().min(1).nullable(),
  version: z.object({
    result: z.enum(["verified", "unknown", "error"]),
    value: z.string().min(1).nullable(),
  }),
  auth: z.object({
    result: z.enum([
      "verified",
      "not_verified",
      "unknown",
      "error",
      "unverified_capability",
    ]),
  }),
  probe_results: z.array(z.object({
    probe: z.string().min(1),
    outcome: z.string().min(1),
  })),
  freshness: z.enum(["fresh", "stale"]),
});

type HarnessDetection = z.infer<typeof detectionSchema>;

type ExecFile = (
  file: string,
  args: string[],
  options: { env: Record<string, string>; timeout: number; maxBuffer: number },
) => Promise<{ code: number | null; stdout: string }>;

const defaultExec: ExecFile = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, options, (error, stdout) => {
      const code = error === null
        ? 0
        : typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null;
      resolve({ code, stdout: String(stdout) });
    });
  });

/** 고정 연결 intent가 부르는 core route 하나. renderer allowlist에는 없고 main만 부른다. */
export const CONNECTION_INTENT = "memory:coding_agent_connections/connect";

export type CliResult =
  | { ok: true; data: unknown }
  | {
    ok: false;
    error: { code: string; message: string; details?: unknown };
  };

/** `lophn <args> --json`을 부른다. 인자는 이 모듈이 정하고 renderer 값은 인자 값으로만 간다. */
export type CliRun = (args: string[]) => Promise<CliResult>;

type CoreResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

export type CodingConnectionDeps = {
  /** main이 사람 credential로 core를 부른다(`CoreSession.internal`). 준비 전이면 null. */
  core(): {
    internal(
      kind: string,
      resource: string,
      method: string,
      body: unknown,
    ): Promise<CoreResult>;
  } | null;
  /** `lophn` child. 설치 경로를 모르면 null이다. */
  cli: CliRun | null;
};

export type CodingConnection = {
  detect(mode: "detect" | "refresh"): Promise<CodingReply<DetectView>>;
  connect(raw: unknown): Promise<CodingReply<ConnectView>>;
};

function fail<T>(
  code: CodingFailureCode,
  message: string,
): CodingReply<T> {
  return { ok: false, error: { code, message } };
}

/**
 * `lophn` 실행 파일 child다. 사람 전용 command라 상속 환경에서 connection·관측 socket·credential 이름을 빼고
 * 부른다. 종료 code와 상관없이 stdout의 JSON 하나를 읽는다(실패 결과도 `{summary,data,next}` 또는
 * `{error}`로 나온다).
 */
export function childCliRunner(options: {
  /** `lophn` 실행 파일 절대 경로. */
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  exec?: ExecFile;
  timeout_ms?: number;
}): CliRun {
  const exec = options.exec ?? defaultExec;
  return async (args) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env)) {
      if (value === undefined) continue;
      if (/^(LOPHN_CONNECTION|LOPHN_TERMINAL_OBSERVE)$/.test(name)) continue;
      if (/(TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
      env[name] = value;
    }
    const ran = await exec(options.command, [...args, "--json"], {
      env,
      timeout: options.timeout_ms ?? 60_000,
      maxBuffer: 4 << 20,
    });
    let body: unknown;
    try {
      body = JSON.parse(ran.stdout);
    } catch {
      return {
        ok: false,
        error: { code: "unavailable", message: "lophn child gave no result" },
      };
    }
    const failure = (body as { error?: unknown } | null)?.error as
      | { code?: unknown; message?: unknown; details?: unknown }
      | undefined;
    if (failure !== undefined) {
      return {
        ok: false,
        error: {
          code: typeof failure.code === "string" ? failure.code : "unavailable",
          message: typeof failure.message === "string"
            ? failure.message
            : "lophn child refused",
          details: failure.details,
        },
      };
    }
    return { ok: true, data: (body as { data?: unknown } | null)?.data };
  };
}

function harnessView(detection: HarnessDetection): HarnessView {
  return {
    harness_id: detection.harness_id,
    discovery: detection.discovery,
    version: detection.version.value,
    version_result: detection.version.result,
    auth: detection.auth.result,
    profile_id: detection.profile_id,
    observed_at: detection.observed_at,
    freshness: detection.freshness,
    executable: detection.selected_executable,
    candidates: detection.candidates.map((item) => ({
      path: item.path,
      source: item.source,
    })),
    probes: detection.probe_results.map((item) => ({
      probe: item.probe,
      outcome: item.outcome,
    })),
  };
}

type Detected = {
  source: DetectView["source"];
  detections: HarnessDetection[];
};

async function readDetections(
  cli: CliRun,
  mode: "detect" | "refresh",
): Promise<{ ok: true; value: Detected } | CodingReply<never>> {
  const ran = await cli(["harness", mode]);
  if (!ran.ok) {
    return fail("unavailable", "harness detection could not be read");
  }
  const data = ran.data as
    | { source?: unknown; detections?: unknown }
    | null
    | undefined;
  const source = data?.source;
  if (
    (source !== "cached" && source !== "first" && source !== "refreshed") ||
    !Array.isArray(data?.detections)
  ) {
    return fail("unavailable", "harness detection has an unknown shape");
  }
  const detections: HarnessDetection[] = [];
  for (const item of data.detections) {
    const parsed = detectionSchema.safeParse(item);
    if (parsed.success) detections.push(parsed.data);
  }
  return { ok: true, value: { source, detections } };
}

function installStatus(data: unknown): ConnectView["install"] {
  const body = data as
    | { install?: unknown; resources?: unknown }
    | null
    | undefined;
  const status = body?.install;
  const known: InstallStatus[] = ["complete", "partial", "failed"];
  const resources = Array.isArray(body?.resources)
    ? body.resources.flatMap((item) => {
      const one = item as { resource_identity?: unknown; outcome?: unknown };
      return typeof one.resource_identity === "string" &&
          typeof one.outcome === "string"
        ? [{ identity: one.resource_identity, outcome: one.outcome }]
        : [];
    })
    : [];
  return {
    status: known.includes(status as InstallStatus)
      ? status as InstallStatus
      : "error",
    resources,
  };
}

function checksOf(data: unknown): ConnectView["checks"] {
  const loading = (data as { loading?: unknown } | null | undefined)?.loading;
  if (!Array.isArray(loading)) return null;
  const checks: { stage: string; result: "success" | "failure" | "unknown" }[] =
    [];
  for (const item of loading) {
    const one = item as { stage?: unknown; result?: unknown };
    if (
      typeof one.stage === "string" &&
      (one.result === "success" || one.result === "failure" ||
        one.result === "unknown")
    ) {
      checks.push({ stage: one.stage, result: one.result });
    }
  }
  return checks;
}

export function createCodingConnection(
  deps: CodingConnectionDeps,
): CodingConnection {
  async function detect(
    mode: "detect" | "refresh",
  ): Promise<CodingReply<DetectView>> {
    if (deps.cli === null) {
      return fail("unavailable", "lophn command is not installed");
    }
    const read = await readDetections(deps.cli, mode);
    if (!("value" in read)) return read;
    return {
      ok: true,
      value: {
        source: read.value.source,
        harnesses: read.value.detections.map(harnessView),
      },
    };
  }

  async function targetOf(
    request: ConnectRequest,
    detection: HarnessDetection,
    core: NonNullable<ReturnType<CodingConnectionDeps["core"]>>,
  ): Promise<{ ok: true; target: unknown } | CodingReply<never>> {
    const base = {
      environment: detection.environment,
      profile_id: detection.profile_id,
      harness_id: detection.harness_id,
    };
    if (request.scope.kind === "all") {
      return {
        ok: true,
        target: {
          scope_kind: "user",
          ...base,
          app: null,
          app_realpath: null,
        },
      };
    }
    const read = await core.internal("read", "apps", "get", {
      app: request.scope.app,
    });
    if (!read.ok) {
      return fail(
        read.error.code === "not_found" ? "invalid_input" : "unavailable",
        "the app could not be read",
      );
    }
    const source = (read.value as { app?: { source_path?: unknown } } | null)
      ?.app?.source_path;
    if (typeof source !== "string" || source === "") {
      return fail("invalid_input", "the app has no source folder");
    }
    return {
      ok: true,
      target: {
        scope_kind: "app",
        ...base,
        app: request.scope.app,
        app_realpath: source,
      },
    };
  }

  return {
    detect,
    async connect(raw) {
      // renderer가 보낸 고정 intent를 이 자리에서 다시 검사한다(desktop#R19).
      const parsed = connectRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return fail("invalid_input", "connect request is not valid");
      }
      const request = parsed.data;
      const cli = deps.cli;
      const core = deps.core();
      if (cli === null || core === null) {
        return fail("unavailable", "lophn is not ready");
      }
      // 연결은 지금 감지된 harness로만 만든다. 감지하지 못한 제품은 거절한다.
      const read = await readDetections(cli, "detect");
      if (!("value" in read)) return read;
      const detection = read.value.detections.find((item) =>
        item.harness_id === request.harness_id && item.discovery === "detected"
      );
      if (detection === undefined) {
        return fail("not_detected", "that product was not detected");
      }
      const target = await targetOf(request, detection, core);
      if (!("target" in target)) return target;
      const connected = await core.internal(
        "memory",
        "coding_agent_connections",
        "connect",
        { label: request.label, scope: request.scope },
      );
      if (!connected.ok) {
        const code = connected.error.code;
        return fail(
          code === "invalid_input" || code === "forbidden" ||
            code === "conflict"
            ? code
            : "unavailable",
          "the connection was not created",
        );
      }
      const id = connectionIdSchema.safeParse(
        (connected.value as { connection?: unknown } | null)?.connection,
      );
      if (!id.success) {
        return fail("unavailable", "the connection answer has no reference");
      }
      const input = JSON.stringify({ target: target.target });
      const installed = await cli([
        "connection",
        "install",
        "--connection",
        id.data,
        "--input",
        input,
      ]);
      const checks = await cli(["doctor", "--input", input]);
      return {
        ok: true,
        value: {
          connection: id.data,
          install: installed.ok
            ? installStatus(installed.data)
            : { status: "error", resources: [] },
          checks: checks.ok ? checksOf(checks.data) : null,
        },
      };
    },
  };
}
