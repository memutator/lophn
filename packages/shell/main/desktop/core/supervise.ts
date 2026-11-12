// core 수명은 shell과 따로다. shell은 core를 ensure로 띄우거나 붙고, 붙은 뒤의 모든 요청은
// control socket 한 줄로 보낸다. 창을 닫거나 Quit해도 core는 남는다.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  err,
  type ErrorCode,
  ok,
  type Result,
  systemClock,
} from "../../../../base/mod.ts";
import type { ConfirmationHandleRegister } from "../../../../protocol/base/mod.ts";
import {
  type ControlDial,
  controlCloseConfirmationWindow,
  controlConfirmationHandle,
  controlConnect,
  controlDiagnostic,
  controlIdentify,
  controlStop,
  coreSocketPath,
  type DetachedStart,
  type EnsureDeps,
  type EnsureFailure,
  ensureCore,
  type EnsuredCore,
  type SpawnDetached,
} from "../../../../protocol/client/mod.ts";
import { LAUNCH_SHELL_ENV } from "../../../../protocol/lophn-agent/host-queue.ts";
import {
  CORE_CONTROL_PROTOCOL_VERSION,
  type ControlConfirmation,
  type ControlConnect,
  type ControlIdentify,
  type Diagnostic,
  START_FAILURE_REASONS,
  type StartFailureReason,
} from "../../../../protocol/supervision/mod.ts";

/** core를 띄울 때 필요한 자리. packaged는 설치 묶음의 platform/, 개발은 저장소 root다. */
export interface ShellLaunch {
  repoRoot: string;
  dataRoot: string;
}

/** root package.json의 판. core의 identify와 대조한다. 없으면 core를 띄우지 않는다. */
export function productVersionOf(repoRoot: string): string | undefined {
  try {
    const version = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ).version;
    return typeof version === "string" && version.length > 0
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

/** control socket 한 줄 왕복. 연결·읽기 실패는 unavailable이다. */
export function controlDial(socketPath: string): ControlDial {
  return (request, timeoutMs) =>
    new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let data = "";
      const socket = connect(socketPath);
      const unavailable = () =>
        finish(
          err({ code: "unavailable", message: "core control에 답이 없다" }),
        );
      const finish = (result: Result<string>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      timer = setTimeout(unavailable, timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write(`${request}\n`));
      socket.on("data", (text: string) => {
        data += text;
        const end = data.indexOf("\n");
        if (end >= 0) finish(ok(data.slice(0, end)));
      });
      socket.on("error", unavailable);
      socket.on("close", unavailable);
    });
}

/**
 * Electron의 Node로 `packages/core/main/daemon/main.ts`를 띄우는 계획. argv·env에 credential은 없다.
 */
function coreLaunch(options: ShellLaunch): {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
} {
  const entry = join(
    options.repoRoot,
    "packages",
    "core",
    "main",
    "daemon",
    "main.ts",
  );
  return {
    // shell main이 Electron이므로 그 binary가 곧 lophn의 Node다. PATH의 node에 기대지 않는다.
    command: process.execPath,
    args: [entry, "--port=0"],
    env: {
      ...process.env,
      // process.execPath가 Electron이어도 이 표시가 없으면 두 번째 Electron 앱으로 뜬다.
      ELECTRON_RUN_AS_NODE: "1",
      LOPHN_HOME: options.dataRoot,
      // 사람이 쓰는 core만 browser가 필요할 때 이 앱을 다시 띄울 수 있다.
      [LAUNCH_SHELL_ENV]: "1",
    },
  };
}

/**
 * ensure가 core를 띄울 때. detached라 shell이 끝나도 core는 남는다. stdout은 core가 첫 JSON 줄
 * (`ready` 또는 `start_failed`)을 쓸 때까지만 읽고 놓는다. token은 그 줄에 없다.
 */
export function spawnDetachedCore(options: ShellLaunch): SpawnDetached {
  return ({ timeoutMs }) =>
    new Promise((resolve) => {
      const launch = coreLaunch(options);
      const child = spawn(launch.command, [...launch.args], {
        cwd: options.repoRoot,
        env: launch.env,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let settled = false;
      let data = "";
      const finish = (result: DetachedStart) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.removeAllListeners("data");
        child.stdout?.destroy();
        child.unref();
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ outcome: "unavailable" }),
        timeoutMs,
      );
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (text: string) => {
        data += text;
        const end = data.indexOf("\n");
        if (end >= 0) finish(startLine(data.slice(0, end)));
      });
      child.on("error", () => finish({ outcome: "unavailable" }));
    });
}

function startLine(line: string): DetachedStart {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; reason?: unknown };
    if (parsed.type === "ready") return { outcome: "ready" };
    if (
      parsed.type === "start_failed" &&
      START_FAILURE_REASONS.includes(parsed.reason as StartFailureReason)
    ) {
      return {
        outcome: "start_failed",
        reason: parsed.reason as StartFailureReason,
      };
    }
  } catch {
    /* 계약 밖 줄은 unavailable이다. core는 계속 돌 수 있으니 다음 ensure가 다시 본다. */
  }
  return { outcome: "unavailable" };
}

// shell main이 core와 주고받는 통로. socket 경로 계산과 IO는 여기서만 한다.
export type ShellCoreControl = {
  /** core가 없으면 한 번 띄우고 붙는다. 판이 다르면 한 번 갈아 띄운다. signal이 서면 새로 띄우지 않는다. */
  ensure(signal?: AbortSignal): Promise<Result<EnsuredCore, EnsureFailure>>;
  /** 지금 core 상태. 답이 없으면 실패한다. */
  identify(): Promise<Result<ControlIdentify>>;
  /** 이미 서 있는 core에만 붙는다. 없거나 판이 다르면 띄우지 않고 실패한다. */
  join(): Promise<Result<ControlConnect, EnsureFailure>>;
  /** control stop. core가 이미 없으면 성공으로 본다. */
  stop(): Promise<Result<null>>;
  diagnostic(diagnostic: Diagnostic): Promise<Result<null>>;
  register(
    capability: string,
    request: ConfirmationHandleRegister,
  ): Promise<Result<ControlConfirmation>>;
  closeWindow(capability: string, windowId: string): Promise<Result<null>>;
};

export function openShellCoreControl(options: {
  launch: ShellLaunch;
  productVersion: string;
}): Result<ShellCoreControl, { code: ErrorCode; message: string }> {
  const socket = coreSocketPath({
    dataRoot: options.launch.dataRoot,
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tempParent: tmpdir(),
    uid: process.getuid?.() ?? 0,
    // base는 node를 import하지 않아 hash를 부르는 곳이 넘긴다.
    hash: (text) => createHash("sha256").update(text).digest("hex"),
  });
  if (!socket.ok) return err(socket.error);
  const dial = controlDial(socket.value);
  const request = { dial };
  const deps: EnsureDeps = {
    dial,
    spawnDetached: spawnDetachedCore(options.launch),
    clock: systemClock,
    timer: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
    },
  };
  const failure = (error: { code: ErrorCode; message: string }) =>
    err({ code: error.code, message: error.message });
  return ok({
    ensure: (signal) =>
      ensureCore(deps, {
        client: "shell",
        productVersion: options.productVersion,
        ...(signal ? { signal } : {}),
      }),
    identify: () => controlIdentify(request),
    async join() {
      const identified = await controlIdentify(request);
      if (!identified.ok) return failure(identified.error);
      if (
        identified.value.state !== "ready" ||
        identified.value.api_url === null
      ) {
        return err({ code: "unavailable", message: "core가 준비되지 않았다" });
      }
      if (
        identified.value.product_version !== options.productVersion ||
        identified.value.protocol_version !== CORE_CONTROL_PROTOCOL_VERSION
      ) {
        return err({ code: "unavailable", message: "core 판이 다르다" });
      }
      const connected = await controlConnect(request, "shell");
      return connected.ok ? connected : failure(connected.error);
    },
    async stop() {
      const stopped = await controlStop(request);
      // core가 이미 없으면 멈출 것도 없다.
      if (!stopped.ok && stopped.error.code !== "unavailable") {
        return failure(stopped.error);
      }
      return ok(null);
    },
    diagnostic: (diagnostic) => controlDiagnostic(request, diagnostic),
    register: (capability, register) =>
      controlConfirmationHandle(request, capability, register),
    closeWindow: (capability, windowId) =>
      controlCloseConfirmationWindow(request, capability, windowId),
  });
}
