import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import {
  err,
  ok,
  type Clock,
  type OsPlatform,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import type {
  ConfirmationHandleRegister,
  Route,
} from "../../../protocol/base/mod.ts";
import { coreSocketPath } from "../../../protocol/client/control-socket.ts";
import {
  controlConfirmationSchema,
  CORE_CONTROL_PROTOCOL_VERSION,
  type ControlClient,
  type ControlConfirmation,
  type ControlConnect,
  type ControlIdentify,
  type ControlState,
} from "../../../protocol/supervision/core-control.ts";
import type { Diagnostic } from "../../../protocol/supervision/mod.ts";
import type { DataRoot } from "../../install-and-update/mod.ts";
import type { CredentialRegistry } from "../../server/identity/mod.ts";
import type { ShellCapabilities } from "../../server/control/capability.ts";
import {
  type ControlDeps,
  type ControlReply,
  handleControlLine,
  userOperations,
} from "../../server/control/handler.ts";
import { startControlServer } from "../../server/control/server.ts";
import { platformPath } from "../../install-and-update/mod.ts";
import type { CoreRuntime } from "./runtime.ts";

// 제품 판은 root package.json 하나다. 이 file 위치에서 본 repo root(개발)이거나 설치본의 platform/(tools/package가
// root package.json을 싣는다)다. notices wiring도 같은 file을 읽는다.
const PRODUCT_PACKAGE_JSON = platformPath(import.meta.url, "package.json");

async function readProductVersion(): Promise<Result<string>> {
  try {
    const version = JSON.parse(
      await readFile(PRODUCT_PACKAGE_JSON, "utf8"),
    ).version;
    if (typeof version === "string" && version.length > 0) return ok(version);
  } catch {
    // 아래 오류로 이어진다.
  }
  return err({ code: "internal", message: "product version is unreadable" });
}

// API·wiring·afterReady가 선 뒤에 넘긴다. 이때부터 identify가 ready이고 connect가 된다.
export type ControlReady = {
  coreEpoch: string;
  apiUrl: string;
  registry: CredentialRegistry;
  routes: readonly Route[];
  events: readonly string[];
  runtime: Pick<CoreRuntime, "record" | "confirmation">;
  capabilities: ShellCapabilities;
  diagnostic(diagnostic: Diagnostic): Promise<void>;
  shutdown(): void;
};

export type CoreControl = {
  handle(line: string): Promise<ControlReply>;
  ready(attached: ControlReady): void;
  // shutdown이 시작됐다. identify가 stopping을 낸다.
  stopping(): void;
  // listener와 socket file을 닫는다. lock을 풀기 전에 부른다.
  close(): Promise<void>;
};

export type CoreControlOptions = {
  root: DataRoot;
  coreEpoch: string;
  clock: Clock;
  random: RandomSource;
  platform: OsPlatform;
  // 없으면 root package.json의 판을 읽는다.
  productVersion?: () => Promise<Result<string>>;
};

// core control socket. instance lock을 잡은 뒤에만 만들고, 종료에서는 lock을 풀기 전에 닫는다.
// 진 core는 살아 있는 core의 socket을 건드리지 않는다.
export async function createCoreControl(
  options: CoreControlOptions,
): Promise<Result<CoreControl>> {
  const socket = coreSocketPath({
    dataRoot: options.root.path,
    platform: options.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    tempParent: tmpdir(),
    uid: process.getuid?.() ?? 0,
    // base는 node를 import하지 않아 hash를 부르는 곳이 넘긴다.
    hash: (text) => createHash("sha256").update(text).digest("hex"),
  });
  if (!socket.ok) {
    return err({ code: "unavailable", message: socket.error.message });
  }
  const readVersion = options.productVersion ?? readProductVersion;
  // ensure가 starting 동안 identify를 되풀이해도 file을 다시 읽지 않는다.
  let knownVersion: string | undefined;
  async function productVersion(): Promise<Result<string>> {
    if (knownVersion !== undefined) return ok(knownVersion);
    const read = await readVersion();
    if (!read.ok) return read;
    knownVersion = read.value;
    return read;
  }
  let state: ControlState = "starting";
  let attached: ControlReady | undefined;

  async function identify(): Promise<Result<ControlIdentify>> {
    const version = await productVersion();
    if (!version.ok) return version;
    return ok({
      product_version: version.value,
      protocol_version: CORE_CONTROL_PROTOCOL_VERSION,
      core_epoch: options.coreEpoch,
      // starting·stopping에는 붙을 API가 없다.
      api_url:
        state === "ready" && attached !== undefined ? attached.apiUrl : null,
      state,
    });
  }

  async function connect(
    client: ControlClient,
  ): Promise<Result<Omit<ControlConnect, "shell_capability">>> {
    if (state !== "ready" || attached === undefined) {
      return err({ code: "unavailable", message: "core가 준비되지 않았다" });
    }
    const issued = await attached.registry.issue({
      actor: "user",
      principal: "user",
      scope: {
        operations: userOperations(attached.routes, attached.events),
        targets: {},
      },
      // shell main과 CLI가 서로 다른 process 조건을 갖는다. 값 자체를 권한 증명으로 쓰지는 않는다.
      conditions: { process: client === "cli" ? "cli" : "electron-main" },
    });
    if (!issued.ok) return issued;
    const current = attached.registry.revalidate({
      credential_ref: issued.value.credential_ref,
    });
    if (!current.ok) return current;
    const recorded = await attached.runtime.record(current.value);
    if (!recorded.ok) return recorded;
    return ok({
      user_token: issued.value.token,
      api_url: attached.apiUrl,
      core_epoch: attached.coreEpoch,
    });
  }

  async function register(
    request: ConfirmationHandleRegister,
  ): Promise<Result<ControlConfirmation>> {
    if (attached === undefined) {
      return err({ code: "unavailable", message: "core가 준비되지 않았다" });
    }
    const issued = await attached.runtime.confirmation({
      action: "issue",
      request,
    });
    if (!issued.ok) return issued;
    const parsed = controlConfirmationSchema.safeParse(issued.value);
    if (!parsed.success) {
      return err({
        code: "internal",
        message: "확인 등록 결과가 계약과 다르다",
      });
    }
    return ok(parsed.data);
  }

  async function closeWindow(windowId: string): Promise<Result<null>> {
    if (attached === undefined) {
      return err({ code: "unavailable", message: "core가 준비되지 않았다" });
    }
    const closed = await attached.runtime.confirmation({
      action: "close-window",
      windowId,
    });
    return closed.ok ? ok(null) : closed;
  }

  const capabilities: ShellCapabilities = {
    issue() {
      if (attached === undefined) {
        throw new Error("core control이 아직 ready가 아니다");
      }
      return attached.capabilities.issue();
    },
    has: (capability) =>
      attached !== undefined && attached.capabilities.has(capability),
    end: (capability) => attached?.capabilities.end(capability),
    onEnd(listener) {
      if (attached === undefined) {
        throw new Error("core control이 아직 ready가 아니다");
      }
      return attached.capabilities.onEnd(listener);
    },
  };

  const deps: ControlDeps = {
    identify,
    connect,
    capabilities,
    register,
    closeWindow,
    shutdown: () => attached?.shutdown(),
    async diagnostic(diagnostic) {
      if (attached === undefined) {
        return err({ code: "unavailable", message: "core가 준비되지 않았다" });
      }
      await attached.diagnostic(diagnostic);
      return ok(null);
    },
  };

  const server = await startControlServer({
    socketPath: socket.value,
    platform: options.platform,
    handle: (line) => handleControlLine(deps, line),
  });
  if (!server.ok) return server;
  return ok({
    handle: (line) => handleControlLine(deps, line),
    ready(ready) {
      attached = ready;
      state = "ready";
    },
    stopping() {
      state = "stopping";
    },
    close: () => server.value.stop(),
  });
}
