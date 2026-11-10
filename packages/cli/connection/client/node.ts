// binary의 core IO다. core와 같은 규칙으로 control socket 경로를 계산해 한 줄 왕복하고,
// core가 없으면 detached로 띄워 stdout 첫 JSON 줄(`ready`/`start_failed`)까지만 읽는다.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type OsPlatform, type Result } from "../../../base/mod.ts";
import {
  type ControlDial,
  coreSocketPath,
  type DetachedStart,
  type SpawnDetached,
} from "../../../protocol/client/mod.ts";
import { LAUNCH_SHELL_ENV } from "../../../protocol/lophn-agent/host-queue.ts";
import {
  START_FAILURE_REASONS,
  type StartFailureReason,
} from "../../../protocol/supervision/mod.ts";

/** control socket 한 줄 왕복. 연결·읽기 실패는 unavailable이다. */
export function controlDial(socketPath: string): ControlDial {
  return (request, timeoutMs) => {
    const { promise, resolve } = Promise.withResolvers<Result<string>>();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let data = "";
    const socket = connect(socketPath);
    const unavailable = () =>
      finish(err({ code: "unavailable", message: "core control에 답이 없다" }));
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
    return promise;
  };
}

/** data root에서 core socket 자리를 구해 붙이는 dial. 경로를 못 구하면 모든 요청이 그 오류로 끝난다. */
export function cliDial(options: {
  dataRoot: string;
  platform: OsPlatform;
  xdgRuntimeDir: string | undefined;
}): Result<ControlDial> {
  const socket = coreSocketPath({
    dataRoot: options.dataRoot,
    platform: options.platform,
    xdgRuntimeDir: options.xdgRuntimeDir,
    tempParent: tmpdir(),
    uid: process.getuid?.() ?? 0,
    // base는 node를 import하지 않아 hash를 부르는 곳이 넘긴다.
    hash: (text) => createHash("sha256").update(text).digest("hex"),
  });
  if (!socket.ok) return err(socket.error);
  return ok(controlDial(socket.value));
}

/**
 * ensure가 core를 띄울 때. detached라 CLI가 끝나도 core는 남는다. stdout은 core가 첫 JSON 줄
 * (`ready` 또는 `start_failed`)을 쓸 때까지만 읽고 놓는다. token은 그 줄에 없다.
 * core entry와 Electron 자리는 설치본의 platform layout과 같은 상대 위치다.
 */
export function spawnDetachedCore(options: {
  platformRoot: string;
  dataRoot: string;
}): SpawnDetached {
  return ({ timeoutMs }) => {
    const { promise, resolve } = Promise.withResolvers<DetachedStart>();
    const entry = join(
      options.platformRoot,
      "packages",
      "core",
      "main",
      "daemon",
      "main.ts",
    );
    // CLI를 띄운 binary(설치본·개발 모두 shell main과 같은 Electron)를 Node로 쓴다. PATH의 node에 기대지 않는다.
    const child = spawn(process.execPath, [entry, "--port=0"], {
      cwd: options.platformRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        LOPHN_HOME: options.dataRoot,
        // 사람이 쓰는 core만 browser가 필요할 때 앱을 띄울 수 있다.
        [LAUNCH_SHELL_ENV]: "1",
      },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
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
    timer = setTimeout(() => finish({ outcome: "unavailable" }), timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (text: string) => {
      data += text;
      const end = data.indexOf("\n");
      if (end >= 0) finish(startLine(data.slice(0, end)));
    });
    child.on("error", () => finish({ outcome: "unavailable" }));
    return promise;
  };
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
