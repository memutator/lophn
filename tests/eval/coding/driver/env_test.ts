import { assertEquals } from "@std/assert";
import { driverEnv, evalPlan } from "./env.ts";

// 틀리면 Claude Code가 session 기록을 안 써서 수치가 빈다.
Deno.test("driverEnv drops nested-session markers and keeps the rest", () => {
  const env = driverEnv({
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDECODE: "1",
    CLAUDE_CONFIG_DIR: "/home/p/.claude-alt",
    HOME: "/home/p",
    UNSET: undefined,
  });
  assertEquals(env, {
    CLAUDE_CONFIG_DIR: "/home/p/.claude-alt",
    HOME: "/home/p",
  });
});

// 틀리면 CLI가 core에 못 닿는다.
Deno.test("evalPlan adds daemon url, command log and PATH without touching the coding token", () => {
  const plan = {
    session: "ses_x",
    env: { LOPHN_CODING_TOKEN: "secret", TERM: "xterm-256color", PATH: "/x" },
  };
  const next = evalPlan(plan, {
    daemonUrl: "http://127.0.0.1:1",
    commandLog: "/out/commands-ses_x.log",
    binDir: "/bin-eval",
    path: "/usr/bin:/bin",
  });
  assertEquals(next, {
    session: "ses_x",
    env: {
      LOPHN_CODING_TOKEN: "secret",
      TERM: "xterm-256color",
      LOPHN_DAEMON_URL: "http://127.0.0.1:1",
      LOPHN_EVAL_COMMAND_LOG: "/out/commands-ses_x.log",
      PATH: "/bin-eval:/usr/bin:/bin",
    },
  });
  assertEquals(plan.env.PATH, "/x");
});
