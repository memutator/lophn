// `terminals/*` route의 처리. 누가 칠 수 있는지(입력 자격), 같은 key의 한 번, 날 출력 lease를 갖는다. 터미널 일 자체는
// `Terminals`가 하고 Bus·탭 열기·자격 표는 wiring이 deps로 끼운다.
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import type {
  TerminalProject,
  TerminalRuntime,
} from "../../protocol/coding-agent/terminals.ts";
import type { TabRelation } from "../../protocol/lophn-agent/host-queue.ts";
import {
  saveTerminalPasteImage,
  type TerminalPasteMediaType,
} from "./paste-image.ts";
import type { Terminals } from "./ports.ts";

// 화면이 10초마다 갱신하고 core는 30초 안에 갱신이 없으면 lease를 거둔다.
export const LEASE_MS = 30_000;
// 다시 보낸 open(전체)과 input(터미널마다)을 알아보는 key 수.
const KEYS_MAX = 200;

const forbidden = (message: string) =>
  err({ code: "forbidden" as const, message });
const gone = () =>
  err({ code: "not_found" as const, message: "terminal is not open" });

// 같은 key는 한 번만 한다. 보내는 중이거나 성공한 것의 답을 주고, 실패한 key는 잊어 다시 보낼 수 있게 한다.
function once<T>(
  table: Map<string, Promise<Result<T>>>,
  key: string | undefined,
  run: () => Promise<Result<T>>,
): Promise<Result<T>> {
  if (key === undefined) return run();
  const seen = table.get(key);
  if (seen !== undefined) return seen;
  const forget = () => {
    if (table.get(key) === sending) table.delete(key);
  };
  const sending = run().then(
    (done) => {
      if (!done.ok) forget();
      return done;
    },
    (error: unknown) => {
      forget();
      throw error;
    },
  );
  table.set(key, sending);
  while (table.size > KEYS_MAX) table.delete(table.keys().next().value!);
  return sending;
}

export type TerminalRoutes = ReturnType<typeof createTerminalRoutes>;

export function createTerminalRoutes(deps: {
  terminals: Terminals;
  clock: Clock;
  // principal이 기기(폰, 연결된 컴퓨터)다.
  isDevice(principal: string): boolean;
  // 기기 principal이 이 기계에서 터미널 입력 허락을 받았다. 기기가 아니면 false다.
  granted(principal: string): boolean;
  // control `connect {client: shell}`이 준 살아 있는 capability다(focus 검사를 거친 shell main만 싣는다).
  capability(value: string): boolean;
  // project(Home이면 `home`)에 터미널 탭을 연다. 그 workspace를 보이는 창이 없으면 탭은 기다리고 터미널은 그대로 돈다.
  openTab(
    project: TerminalProject,
    terminal: string,
    relation: TabRelation | null,
  ): void;
  // 터미널에 붙여 넣은 이미지를 저장할 임시 폴더.
  pasteImageDir?: string;
}) {
  const { terminals } = deps;
  const leases = new Map<string, { terminal: string; expiresAt: number }>();
  const attached = new Set<string>();
  const syncAttached = (terminal: string) => {
    const now = deps.clock.nowMs();
    let active = false;
    for (const lease of leases.values()) {
      if (lease.terminal === terminal && lease.expiresAt > now) {
        active = true;
        break;
      }
    }
    if (active && !attached.has(terminal)) {
      attached.add(terminal);
      terminals.setClientAttached(terminal, true);
    } else if (!active && attached.has(terminal)) {
      attached.delete(terminal);
      terminals.setClientAttached(terminal, false);
    }
  };
  const opens = new Map<
    string,
    Promise<Result<{ terminal: string; runtime: TerminalRuntime }>>
  >();
  const inputs = new Map<
    string,
    Map<string, Promise<Result<Record<string, never>>>>
  >();
  const runtimeOf = (result: Result<TerminalRuntime>) =>
    result.ok ? ok({ runtime: result.value }) : result;
  // 기기는 그 기기의 터미널 입력 허락이, 기기가 아니면 살아 있는 shell capability가 있어야 PTY를 움직인다.
  const allowed = (principal: string, capability: string | undefined) =>
    deps.granted(principal) ||
    (capability !== undefined && deps.capability(capability));

  return {
    list(input: { project?: TerminalProject }) {
      return ok({ terminals: [...terminals.list(input.project)] });
    },

    // 열면서 치는 `command`·`resume`도 입력이다. 허락이 없는 기기는 빈 터미널만 연다. 사람 화면의 열기는 focus를 보지 않는다.
    open(
      principal: string,
      input: {
        project: TerminalProject;
        folder_ref?: string;
        worktree_id?: string;
        cwd?: string;
        command?: string;
        resume?: { harness: string; external_session: string };
        key?: string;
        tab?: { relation: TabRelation | null };
      },
    ) {
      const types = input.command !== undefined || input.resume !== undefined;
      if (types && deps.isDevice(principal) && !deps.granted(principal)) {
        return Promise.resolve(
          forbidden("this device may not type into the terminal"),
        );
      }
      return once(opens, input.key, async () => {
        const { key: _key, tab, ...open } = input;
        const opened = await terminals.open(open);
        if (!opened.ok) return opened;
        const terminal = opened.value.terminal_ref;
        if (tab !== undefined)
          deps.openTab(input.project, terminal, tab.relation);
        return ok({ terminal, runtime: opened.value });
      });
    },

    async close(input: { terminal: string; generation: number }) {
      return runtimeOf(await terminals.close(input.terminal, input.generation));
    },

    // 다시 띄우기는 입력과 같은 자격이다(`allowed`). 이 컴퓨터의 창은 shell main이 focus를 본 뒤 capability를 싣고, 다른
    // 기계의 창은 그 기계가 받은 이 컴퓨터의 터미널 입력 허락으로 부른다.
    async restart(
      principal: string,
      input: {
        terminal: string;
        generation: number;
        shell_capability?: string;
      },
    ) {
      if (!allowed(principal, input.shell_capability)) {
        return forbidden("this caller may not restart the terminal");
      }
      return runtimeOf(
        await terminals.restart(input.terminal, input.generation),
      );
    },

    // 친다. 자격은 `allowed`이고 agent 자격은 dispatch가 막는다.
    input(
      principal: string,
      input: {
        terminal: string;
        generation?: number;
        text: string;
        key?: string;
        respond?: boolean;
        shell_capability?: string;
      },
    ): Promise<Result<Record<string, never>>> {
      if (!allowed(principal, input.shell_capability)) {
        return Promise.resolve(
          forbidden("this caller may not type into the terminal"),
        );
      }
      let table = inputs.get(input.terminal);
      if (table === undefined) inputs.set(input.terminal, (table = new Map()));
      return once(table, input.key, async () => {
        const done = await terminals.write(input.terminal, input.text, {
          generation: input.generation,
          // xterm이 출력의 질의에 답한 것은 사람 입력이 아니다.
          human: input.respond !== true,
        });
        return done.ok ? ok({}) : done;
      });
    },

    // 이미지 붙여넣기·drop: 입력과 같은 자격(`allowed`)으로 검증하고 임시 파일에 저장한 뒤 경로를 돌려준다.
    async pasteImage(
      principal: string,
      input: {
        terminal: string;
        media_type: TerminalPasteMediaType;
        data_base64: string;
        shell_capability?: string;
      },
    ): Promise<Result<{ path: string; bytes: number }>> {
      if (!allowed(principal, input.shell_capability)) {
        return forbidden("this caller may not paste images into the terminal");
      }
      if (terminals.runtime(input.terminal) === null) return gone();
      if (deps.pasteImageDir === undefined) {
        return err({
          code: "unavailable",
          message: "temporary image directory is not configured",
        });
      }
      return await saveTerminalPasteImage(
        { dir: deps.pasteImageDir, clock: deps.clock },
        { media_type: input.media_type, data_base64: input.data_base64 },
      );
    },

    async resize(input: {
      terminal: string;
      generation: number;
      columns: number;
      rows: number;
    }) {
      return runtimeOf(
        await terminals.resize(
          input.terminal,
          input.generation,
          { columns: input.columns, rows: input.rows },
          { remote: false },
        ),
      );
    },

    snapshot(input: { terminal: string; after_seq?: number }) {
      return terminals.snapshot(input.terminal, input.after_seq);
    },

    // lease는 (principal, watcher)가 터미널마다 하나다. 한 principal의 여러 화면이 따로 잡고 놓는다.
    watch(
      principal: string,
      input: { terminal: string; watcher: string; on: boolean },
    ) {
      const key = `${principal}\n${input.watcher}\n${input.terminal}`;
      if (!input.on) {
        leases.delete(key);
        syncAttached(input.terminal);
        return ok({});
      }
      if (terminals.runtime(input.terminal) === null) return gone();
      leases.set(key, {
        terminal: input.terminal,
        expiresAt: deps.clock.nowMs() + LEASE_MS,
      });
      syncAttached(input.terminal);
      return ok({});
    },

    name(input: { terminal: string; name: string }) {
      if (terminals.runtime(input.terminal) === null) return gone();
      terminals.patch(input.terminal, { tab_name: input.name });
      return ok({});
    },

    // 이 터미널에 기한이 남은 lease가 하나라도 있다. 있는 동안만 날 출력을 Bus에 낸다.
    watched(terminal: string): boolean {
      const now = deps.clock.nowMs();
      for (const lease of leases.values()) {
        if (lease.terminal === terminal && lease.expiresAt > now) return true;
      }
      return false;
    },

    // 기한이 지난 lease를 거둔다(주기로 부른다).
    expire(): void {
      const now = deps.clock.nowMs();
      const touched = new Set<string>();
      for (const [key, lease] of leases) {
        if (lease.expiresAt <= now) {
          leases.delete(key);
          touched.add(lease.terminal);
        }
      }
      for (const terminal of touched) syncAttached(terminal);
    },
  };
}
