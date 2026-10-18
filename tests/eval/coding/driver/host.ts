// shell의 터미널 몫을 한 프로세스 안에서 조립한다. PTY host와 core 요청 처리는 shell의 코드 그대로이고 여기서는 잇기만 한다.
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";

import {
  codingTerminalExited,
  codingTerminalResult,
} from "../../../../packages/protocol/coding-agent/mod.ts";
import type {
  TerminalReply,
  TerminalRuntime,
} from "../../../../packages/shell/ipc/terminal.ts";
import {
  type CodingTerminalRequests,
  createCodingTerminalRequests,
} from "../../../../packages/shell/main/terminal/coding/requests.ts";
import { createCodingHost } from "../../../../packages/shell/terminal-host/launch-plan.ts";
import {
  hostFromNodePty,
  type HostRequest,
} from "../../../../packages/shell/terminal-host/main.ts";
import { nodePtyAdapter } from "../../../../packages/shell/terminal-host/pty.ts";
import type { Core } from "../../../support/core/mod.ts";
import { driverEnv } from "./env.ts";
import type { FocusGate } from "./focus.ts";
import { CHECKOUT } from "./wrapper.ts";

type PtyHost = ReturnType<typeof hostFromNodePty>;
type Body<T> = T extends (body: infer B) => unknown ? B : never;

export type EvalTerminal = {
  host: PtyHost;
  requests: CodingTerminalRequests;
  /** shell supervisor의 request와 같다. 답에 실린 runtime도 onRuntime 듣는 쪽에 알린다. */
  request(message: unknown): Promise<TerminalReply>;
  /** process가 끝났다는 줄과 요청의 답에 실린 runtime을 듣는다. */
  onRuntime(listener: (runtime: TerminalRuntime) => void): void;
};

const libc = Deno.dlopen(
  process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6",
  { write: { parameters: ["i32", "buffer", "usize"], result: "isize" } },
);

// Deno의 node:fs는 native addon이 만든 master fd를 자기 resource로 몰라 write가 EBADF가 된다
// (읽기는 tty.ReadStream이라 된다). 입력은 짧은 키라서 libc write를 직접 부른다.
function loadNodePty(): ReturnType<
  NonNullable<Parameters<typeof nodePtyAdapter>[0]>
> {
  const nodePty = createRequire(
    `${CHECKOUT}/packages/shell/main/package.json`,
  )("node-pty");
  const spawn = nodePty.spawn;
  return {
    spawn(...args: unknown[]) {
      const term = spawn(...args);
      term.write = (data: string) => {
        let rest = new TextEncoder().encode(data);
        while (rest.length > 0) {
          const n = Number(
            libc.symbols.write(term.fd, rest, BigInt(rest.length)),
          );
          if (n < 0) throw new Error("pty write failed");
          rest = rest.subarray(n);
        }
      };
      return term;
    },
  };
}

export function createEvalTerminal(deps: {
  core: Core;
  gate: FocusGate;
  // core에 알릴 body를 driver도 본다(open이 ok가 된 때를 안다).
  onResult(
    body: Body<
      Parameters<typeof createCodingTerminalRequests>[0]["reportResult"]
    >,
  ): void;
}): EvalTerminal {
  const listeners = new Set<(runtime: TerminalRuntime) => void>();
  const table = new Map<string, TerminalRuntime>();
  // supervisor.ts의 refreshRuntime과 같다. generation이 더 큰 쪽이 이긴다.
  function notify(runtime: TerminalRuntime): void {
    const known = table.get(runtime.terminal_ref);
    if (known === undefined || known.generation <= runtime.generation) {
      table.set(runtime.terminal_ref, runtime);
    }
    for (const listener of listeners) listener(runtime);
  }

  const host = hostFromNodePty({
    env: driverEnv(Deno.env.toObject()),
    platform: process.platform,
    exists: existsSync,
    checkFolder: (path) => {
      try {
        if (!statSync(path).isDirectory()) {
          return { ok: false, reason: "not_directory" };
        }
        return { ok: true, path };
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },
    schedule: setImmediate,
    coding: createCodingHost(),
    // node-pty는 shell main의 의존성이라 Deno의 기본 경로 탐색으로는 못 찾는다.
    pty: nodePtyAdapter(loadNodePty),
    onRuntime: notify,
  });

  let seq = 0;
  const supervisor = {
    on(listener: { runtime?(runtime: TerminalRuntime): void }) {
      const call = listener.runtime;
      if (call) listeners.add(call);
      return () => {
        if (call) listeners.delete(call);
      };
    },
    async request(message: unknown): Promise<TerminalReply> {
      const reply = await host.handle(
        { ...message as object, id: String(++seq) } as HostRequest,
      );
      if (reply.ok && "runtime" in reply) notify(reply.runtime);
      return reply as TerminalReply;
    },
    runtimes: () => [...table.values()],
  };

  const requests = createCodingTerminalRequests({
    supervisor,
    focus: deps.gate,
    reportResult: (body) => {
      deps.onResult(body);
      return deps.core.call(codingTerminalResult, body);
    },
    reportExited: (body) => deps.core.call(codingTerminalExited, body),
    runCli: null,
  });

  return {
    host,
    requests,
    request: supervisor.request,
    onRuntime: (listener) => void listeners.add(listener),
  };
}
