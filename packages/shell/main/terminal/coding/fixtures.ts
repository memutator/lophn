// coding TUI 시작 시험의 공통 fixture다. 제품 코드는 import하지 않는다. 실제 coding agent 제품은 열지 않고
// PATH 폴더의 fake coding agent(shell script)를 executable로 쓴다. PTY는 pipe로 대신한다(node-pty는 native다).
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodingAgentLaunchPlan } from "../../../../protocol/coding-agent/mod.ts";
import { posixGroup } from "../../../terminal-host/child-group.ts";
import type { PtyAdapter, PtyHandle } from "../../../terminal-host/pty.ts";

export const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
export const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
export const AT = "2026-10-05T00:00:00.000Z";

export function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `lophn-${name}-`));
}

export type FakeAgent = {
  /** PATH에 넣는 폴더. */
  bin: string;
  executable: string;
  /** 시험이 읽는 기록 폴더. */
  out: string;
  read(name: string): string | undefined;
};

/**
 * `fake-coding-agent`라는 이름의 TUI 대역이다. argv·cwd·env를 기록하고 선택하면 준비 표시를 낸 뒤
 * CR까지 한 번 읽어 stdin 기록에 남기고 기다린다.
 */
export function fakeAgent(): FakeAgent {
  const root = tempDir("fake-agent");
  const bin = join(root, "bin");
  const out = join(root, "out");
  mkdirSync(bin);
  mkdirSync(out);
  const executable = join(bin, "fake-coding-agent");
  writeFileSync(
    executable,
    [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "$@" > "$FAKE_AGENT_OUT/argv"',
      'env > "$FAKE_AGENT_OUT/env"',
      'pwd > "$FAKE_AGENT_OUT/cwd"',
      'if [ -n "$FAKE_AGENT_READY" ]; then printf "%s" "$FAKE_AGENT_READY"; fi',
      'if [ "$FAKE_AGENT_READ" = 1 ]; then',
      "  IFS= read -r -d $'\\r' line",
      '  printf "%s" "$line" > "$FAKE_AGENT_OUT/stdin"',
      "fi",
      'exec sleep "${FAKE_AGENT_SLEEP:-30}"',
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
  return {
    bin,
    executable,
    out,
    read(name) {
      const file = join(out, name);
      return existsSync(file) ? readFileSync(file, "utf8") : undefined;
    },
  };
}

export type PipePty = PtyAdapter & {
  children: ChildProcess[];
  writes: string[];
  stop(): void;
};

/** 실제 process를 pipe로 연다. 같은 argv·cwd·env로 executable을 직접 spawn한다(shell 없음). */
export function pipePty(): PipePty {
  const children: ChildProcess[] = [];
  const writes: string[] = [];
  return {
    children,
    writes,
    spawn(options): PtyHandle {
      const child = spawn(options.file, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "ignore"],
        detached: true,
      });
      children.push(child);
      child.stdin?.on("error", () => {});
      return {
        pid: child.pid ?? 0,
        write(data) {
          writes.push(data);
          child.stdin?.write(data);
        },
        resize() {},
        kill(signal) {
          try {
            process.kill(
              -(child.pid ?? 0),
              (signal ?? "SIGTERM") as NodeJS.Signals,
            );
          } catch {
            // 이미 끝났다.
          }
        },
        onData(listener) {
          child.stdout?.on("data", (chunk) => listener(String(chunk)));
          return { dispose() {} };
        },
        onExit(listener) {
          child.on(
            "exit",
            (code, signal) =>
              listener({ exitCode: code ?? (signal ? 128 : 0) }),
          );
          return { dispose() {} };
        },
      };
    },
    group: posixGroup,
    stop() {
      for (const child of children) {
        try {
          process.kill(-(child.pid ?? 0), "SIGKILL");
        } catch {
          // 이미 끝났다.
        }
      }
    },
  };
}

export function launchPlan(
  agent: { executable: string },
  cwd: string,
  patch: Partial<CodingAgentLaunchPlan> = {},
): CodingAgentLaunchPlan {
  return {
    ticket: TKT,
    ticket_revision: "12",
    harness_id: "claude",
    catalog_revision: "rev-1",
    adapter_revision: "rev-1",
    environment: { kind: "host", identity: "work" },
    profile_id: null,
    connection: CAC,
    project: PRJ,
    folder_ref: "src",
    cwd,
    method: "terminal_tui",
    executable: agent.executable,
    argv: ["claude", "--flag", "first prompt\nwith a second line"],
    env_names: ["TERM", "COLORTERM", "LOPHN_CONNECTION"],
    env_overlay: {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LOPHN_CONNECTION: CAC,
    },
    env_delete: [
      "LOPHN_TERMINAL_OBSERVE",
      "LOPHN_TOKEN",
      "LOPHN_CREDENTIAL",
      "LOPHN_APP_BROKER_CREDENTIAL",
    ],
    first_prompt: "read the ticket, claim it with MCP, work, report",
    prompt_delivery: { mode: "argv" },
    human_start_handle: "hsh_1",
    operation_id: "op_1",
    ...patch,
  };
}

/** hook이 보내는 observation payload다. 정체 값은 일부러 틀리게 주장한다. */
export function hookPayload(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    harness_id: "someone-else",
    environment: { kind: "host", identity: "elsewhere" },
    profile_id: "other",
    catalog_revision: "rev-x",
    adapter_revision: "rev-x",
    origin: "external_terminal",
    runtime_ref: "term_claimed",
    connection: null,
    ticket: null,
    cwd: "/not/the/cwd",
    provider_session: null,
    state: "working",
    observed_at: AT,
    evidence_source: "hook",
    evidence_ref: "hook/user_prompt_submit",
    freshness: "fresh",
    reason: null,
    ...patch,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function until(
  ready: () => boolean,
  limit = 5_000,
): Promise<void> {
  const end = Date.now() + limit;
  while (!ready()) {
    if (Date.now() > end) throw new Error("condition was not reached");
    await sleep(10);
  }
}

export type FakeLophn = { command: string; read(): unknown };

/**
 * `lophn session plan --json --input <json>`의 대역(node script)이다. 사람 전용이라 LOPHN_CONNECTION이
 * 환경에 있으면 거절하고, 받은 입력을 기록한 뒤 입력의 값 그대로 plan을 낸다. FAKE_PLAN_EXECUTABLE이
 * executable이고 FAKE_PLAN_HARNESS·FAKE_PLAN_CWD가 있으면 일부러 다른 값을 낸다(대체 시험).
 */
export function fakeLophn(): FakeLophn {
  const root = tempDir("fake-lophn");
  const out = join(root, "input.json");
  const command = join(root, "lophn");
  writeFileSync(
    command,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const fail = (code, message, details) => {
  process.stdout.write(JSON.stringify({ error: { code, message, details } }) + "\\n");
  process.exit(1);
};
if (args.slice(0, 4).join(" ") !== "session plan --json --input") fail("invalid_input", "args");
if (process.env.LOPHN_CONNECTION) fail("forbidden", "human only");
const input = JSON.parse(args[4]).plan_input;
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(input));
if (!input.facts) fail("unavailable", "no facts", { next: ["read again"] });
if (input.facts.connection_state !== "active") fail("conflict", "revoked", { next: ["reconnect"] });
const delivery = process.env.FAKE_PLAN_DELIVERY === "stdin"
  ? { mode: "stdin_after_ready", readiness: process.env.FAKE_AGENT_READY, deadline_ms: 10000 }
  : { mode: "argv" };
const plan = {
  ticket: input.ticket,
  ticket_revision: input.ticket_revision,
  harness_id: process.env.FAKE_PLAN_HARNESS || input.harness_id,
  catalog_revision: "rev-1",
  adapter_revision: "rev-1",
  environment: { kind: "host", identity: "work" },
  profile_id: input.profile_id ?? null,
  connection: input.connection,
  project: input.project,
  folder_ref: input.folder_ref,
  cwd: process.env.FAKE_PLAN_CWD || input.cwd,
  method: input.method,
  executable: process.env.FAKE_PLAN_EXECUTABLE,
  argv: ["claude", "--flag", "first prompt\\nwith a second line"],
  env_names: ["TERM", "LOPHN_CONNECTION"],
  env_overlay: { TERM: "xterm-256color", LOPHN_CONNECTION: input.connection },
  env_delete: ["LOPHN_TERMINAL_OBSERVE", "LOPHN_TOKEN"],
  first_prompt: "read the ticket, claim it with MCP, work, report",
  prompt_delivery: delivery,
  human_start_handle: input.human_start_handle,
  operation_id: input.operation_id,
};
process.stdout.write(JSON.stringify({ summary: "plan", data: { plan }, next: [] }) + "\\n");
`,
  );
  chmodSync(command, 0o755);
  return {
    command,
    read() {
      return existsSync(out)
        ? JSON.parse(readFileSync(out, "utf8"))
        : undefined;
    },
  };
}

export function ticketDetail(patch: Record<string, unknown> = {}) {
  return {
    ticket: {
      id: TKT,
      app: APP,
      kind: "implementation",
      title: "Add a thing",
      request: "add a thing to the app",
      problem_count: 0,
      screen_state: "ready",
      next_action: "start",
      why: "because",
      needs: [],
      problems: [],
      inspect: ["src/app.ts"],
      preserve: [],
      claim: null,
      conditions: [],
      completion: null,
      checks: [],
      remaining: [],
      revision: "12",
      ...patch,
    },
    as_of_seq: "40",
    next_cursor: null,
  };
}

export function connectionShown(patch: Record<string, unknown> = {}) {
  return {
    connection: {
      id: CAC,
      label: "work",
      scope: { kind: "all", app: null },
      principal: `coding_agent:${CAC}`,
      state: "active",
      revision: "3",
      ...patch,
    },
    as_of_seq: "40",
    next_cursor: null,
  };
}
