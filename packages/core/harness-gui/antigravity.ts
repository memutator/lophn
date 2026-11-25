// Antigravity(`agy`) adapter. Thin wrapper over the shared 4-layer ACP client
// (`./acp-client/`) and `AntigravityDialect`.

import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { Result } from "../../base/result.ts";
import type {
  AcpTerminal,
  HarnessCatalogResult,
  HarnessLaunchConfig,
} from "../../protocol/acp/mod.ts";
import { GUI_HANDOFF } from "../../protocol/acp/mod.ts";
import {
  createAntigravityDialect,
  fetchAcpCatalog,
  type ReactiveWakeupTimers,
  startAcpDialectSession,
} from "./acp-client/index.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

export type { HarnessCatalogResult, HarnessLaunchConfig };

export type AntigravityAdapter = HarnessGuiAdapter & {
  catalogScope: "global";
  enforcesDeny: false;
};

/** adapter가 파일 시스템에 닿는 길. 이미지 첨부를 읽고 agy 대화 file이 있는지만 본다. 쓰는 길은 없다. test가 바꾼다. */
export type AntigravityIo = {
  /** 사람의 home. `<home>/.gemini/antigravity-cli/conversations/<id>.db`가 대화 하나다. */
  home: string;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Optional timing overrides for fast deterministic tests. */
  loadReplayQuietPeriodMs?: number;
  childPollIntervalMs?: number;
  reactiveTimers?: Partial<ReactiveWakeupTimers>;
  requestTimeoutMs?: number;
  stopTimeouts?: { cancelMs?: number; closeMs?: number; exitMs?: number };
};

export function createAntigravityAdapter(
  io: AntigravityIo,
): AntigravityAdapter {
  const makeDialect = () =>
    createAntigravityDialect({
      home: io.home,
      exists: io.exists,
      ...(io.loadReplayQuietPeriodMs === undefined
        ? {}
        : { loadReplayQuietPeriodMs: io.loadReplayQuietPeriodMs }),
      ...(io.childPollIntervalMs === undefined
        ? {}
        : { childPollIntervalMs: io.childPollIntervalMs }),
      ...(io.reactiveTimers === undefined
        ? {}
        : { reactiveTimers: io.reactiveTimers }),
    });

  return {
    handoff: GUI_HANDOFF.antigravity,
    catalogScope: "global",
    enforcesDeny: false,
    fetchCatalog(options) {
      return fetchAcpCatalog({
        dialect: makeDialect(),
        home: io.home,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        spawn: options.spawn,
        signal: options.signal,
      });
    },
    start({ cwd, resume, args, carry, launch, session, spawn, clock, ids }) {
      return startAcpDialectSession({
        dialect: makeDialect(),
        cwd,
        ...(resume === undefined ? {} : { resume }),
        ...(args === undefined ? {} : { args }),
        ...(carry === undefined ? {} : { carry }),
        ...(launch === undefined ? {} : { launch }),
        session,
        spawn,
        clock,
        ids,
        readFile: io.readFile,
        ...(io.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: io.requestTimeoutMs }),
        ...(io.stopTimeouts === undefined
          ? {}
          : { stopTimeouts: io.stopTimeouts }),
      });
    },
    // TUI의 agy는 Ctrl+C를 두 번 눌러야 끝난다(첫 번은 입력을 지우거나 도는 일을 멈추고 안내만 낸다). foreground가 끝난 뒤에야
    // resolve해서 한 대화를 두 process가 같이 쥐지 않는다.
    exitTui(terminal: AcpTerminal) {
      return new Promise<Result<void>>((resolve) => {
        let presses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = setTimeout(
          () =>
            finish({
              ok: false,
              error: {
                code: "unavailable",
                message: "Antigravity did not exit after Ctrl+C.",
              },
            }),
          5000,
        );
        const off = terminal.onForegroundExit(() =>
          finish({ ok: true, value: undefined }),
        );
        function finish(result: Result<void>) {
          clearTimeout(timer);
          clearTimeout(deadline);
          off();
          resolve(result);
        }
        function press() {
          if (terminal.state() === "shell") {
            return finish({ ok: true, value: undefined });
          }
          if (presses >= 4) return;
          presses += 1;
          terminal.type("\x03");
          timer = setTimeout(press, 400);
        }
        press();
      });
    },
  };
}

export const antigravityAdapter = createAntigravityAdapter({
  home: homedir(),
  readFile,
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
});
