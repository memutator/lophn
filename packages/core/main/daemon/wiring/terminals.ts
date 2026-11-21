// terminals: core가 PTY host를 자식으로 띄워 사람의 터미널을 갖는다. `ctx.terminals`(터미널 port)와 `ctx.personEnv`(사람의 login
// env와 `lophn` 경로)를 내고 `terminals/*` route를 둔다. 날 출력은 `terminals/watch` lease가 있는 터미널만 Bus에 내고, runtime이
// 바뀌면 lease와 상관없이 낸다. core가 끝나면(closeWork) host stdin을 닫아 host가 모든 PTY를 끝낸다. 앱(shell)의 Quit은 이 수명과 상관없다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { err, ok } from "../../../../base/mod.ts";
import {
  HOME_TERMINAL_PROJECT,
  terminalsClose,
  terminalsInput,
  terminalsList,
  terminalsName,
  terminalsOpen,
  terminalsResize,
  terminalsRestart,
  terminalsSnapshot,
  terminalsWatch,
} from "../../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { codingAgentsSetting } from "../../../config/mod.ts";
import {
  projectExists,
  projectFolderPaths,
} from "../../../projects/lookups.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import {
  createPersonEnv,
  createTerminalRoutes,
  createTerminals,
  lophnCliPath,
  type RunLoginShell,
  spawnNodeHost,
} from "../../../terminals/mod.ts";
import type { Terminals } from "../../../terminals/ports.ts";
import { installedLayout } from "../entry-layout.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// lease 기한(30초)을 이 주기로 본다.
const EXPIRE_MS = 5000;

const HOST_ENTRY = fileURLToPath(
  new URL("../../../terminals/host/cli.ts", import.meta.url),
);
// 설치본은 platform/ 폴더, 개발은 저장소 root다.
const PLATFORM_ROOT = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);

// login shell을 shell 없이 한 번 띄워 stdout을 모은다. 기한을 넘기면 끄고 null이다.
const runLoginShell: RunLoginShell = (shell, args, env, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(shell, [...args], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (text: string) => {
      out += text;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

export const terminalsWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let terminals: Terminals | undefined;
  return {
    name: "terminals",
    prepare(ctx) {
      const personEnv = createPersonEnv({
        platform: process.platform,
        env: process.env,
        run: runLoginShell,
        cli: lophnCliPath({
          installed: installedLayout(PLATFORM_ROOT, existsSync),
          platformRoot: PLATFORM_ROOT,
          platform: process.platform,
          exists: existsSync,
        }),
      });
      ctx.provide("personEnv", personEnv);
      const made = createTerminals({
        spawnHost: (env) => spawnNodeHost(HOST_ENTRY, env),
        personEnv,
        // 등록 폴더는 projects module의 읽기 함수로 본다. 연결은 처음 터미널을 열 때 연다.
        // Home에는 등록 폴더가 없다. 터미널은 사람의 home 폴더에서 연다(셸이 어디서나 시작하는 자리).
        async folders(project) {
          if (project === HOME_TERMINAL_PROJECT) {
            return ok([{ folder_ref: `${project}_0`, path: homedir() }]);
          }
          if (connection === undefined) {
            const opened = openConnection(ctx.ledgerPath);
            if (!opened.ok) return opened;
            connection = opened.value;
          }
          const sql = connection.sql;
          if (!projectExists(sql, project)) {
            return err({ code: "not_found", message: "project not found" });
          }
          return ok(
            projectFolderPaths(sql, project).map((path, index) => ({
              folder_ref: `${project}_${index}`,
              path,
            })),
          );
        },
        platform: process.platform,
        codingCommand: (harness) =>
          ctx.peek.settings?.get(codingAgentsSetting)?.commands?.[harness],
        hostExited(exit) {
          ctx.telemetry.logger.warn({
            component: "terminals",
            event: "terminal_host_exited",
            fields: {
              code: exit.code,
              signal: exit.signal,
              stderr: exit.stderr,
            },
          });
        },
      });
      ctx.provide("terminals", made);
    },
    build(ctx) {
      terminals = ctx.terminals;
      const routes = createTerminalRoutes({
        terminals,
        clock: ctx.clock,
        isDevice: (principal) => ctx.peek.deviceKind?.(principal) != null,
        granted: (principal) =>
          ctx.peek.terminalInputGrant?.(principal) ?? false,
        capability: (value) => ctx.peek.shellCapabilities?.has(value) ?? false,
        openTab(project, terminal, relation) {
          ctx.hostQueue.openTab({
            owner: "person",
            workspace:
              project === HOME_TERMINAL_PROJECT
                ? { kind: "home" }
                : { kind: "project", id: project },
            target: { terminal: { terminal_ref: terminal } },
            relation,
            source: null,
          });
        },
      });
      const publish = (event: BusEvent) => ctx.bus.publish(event);
      terminals.onRuntime((runtime) => {
        publish({
          type: "TerminalRuntimeChanged",
          subject: `terminal:${runtime.terminal_ref}`,
          at: ctx.clock.now(),
          payload: { runtime },
        } as BusEvent);
      });
      // host가 16ms·64Ki로 묶은 chunk 하나가 event 하나다. lease가 없는 터미널은 host의 화면만 이어진다.
      terminals.onOutput((output) => {
        for (const chunk of output) {
          if (!routes.watched(chunk.terminal_ref)) continue;
          publish({
            type: "TerminalOutputAppended",
            subject: `terminal:${chunk.terminal_ref}`,
            at: ctx.clock.now(),
            payload: chunk,
          } as BusEvent);
        }
      });
      timer = setInterval(() => routes.expire(), EXPIRE_MS);
      timer.unref?.();
      return ok({
        memory: [
          [
            key(terminalsOpen),
            (who, input) =>
              routes.open(
                who.principal,
                input as Parameters<typeof routes.open>[1],
              ),
          ],
          [
            key(terminalsClose),
            (_who, input) =>
              routes.close(input as Parameters<typeof routes.close>[0]),
          ],
          [
            key(terminalsRestart),
            (who, input) =>
              routes.restart(
                who.principal,
                input as Parameters<typeof routes.restart>[1],
              ),
          ],
          [
            key(terminalsInput),
            (who, input) =>
              routes.input(
                who.principal,
                input as Parameters<typeof routes.input>[1],
              ),
          ],
          [
            key(terminalsResize),
            (_who, input) =>
              routes.resize(input as Parameters<typeof routes.resize>[0]),
          ],
          [
            key(terminalsWatch),
            (who, input) =>
              routes.watch(
                who.principal,
                input as Parameters<typeof routes.watch>[1],
              ),
          ],
          [
            key(terminalsName),
            (_who, input) =>
              routes.name(input as Parameters<typeof routes.name>[0]),
          ],
        ],
        reads: (reads) => {
          reads.set(key(terminalsList), (_who, input) =>
            routes.list(input as Parameters<typeof routes.list>[0]),
          );
          reads.set(key(terminalsSnapshot), (_who, input) =>
            routes.snapshot(input as Parameters<typeof routes.snapshot>[0]),
          );
        },
      });
    },
    // core가 끝난다. host stdin을 닫아 host가 모든 PTY를 SIGHUP·SIGKILL까지 끝내게 한다.
    async closeWork() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await terminals?.stop();
      connection?.close();
      connection = undefined;
    },
  };
};
