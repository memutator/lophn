// driver가 PTY의 env와 launch plan에 더하는 순수 값.

// Claude Code 안에서 runner를 돌리면 상속되는 중첩 표시 변수다. 있으면 Claude Code가 session 기록을 안 쓴다
// (`CLAUDE_CODE_CHILD_SESSION`이 있으면 "Transcript saving is off"). 사람이 건 설정(`CLAUDE_CONFIG_DIR` 등)은 지우지 않는다.
const NESTED = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
];

// host의 env로 넘긴다. platform 값은 host(createCodingHost)가 지우므로 여기서 또 지우지 않는다.
export function driverEnv(
  inherited: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined || NESTED.includes(name)) continue;
    out[name] = value;
  }
  return out;
}

type Extras = {
  daemonUrl: string;
  commandLog: string;
  binDir: string;
  path: string;
};

// plan.env에 core 주소(CLI가 찾을 길이 없다), 명령 기록 file, wrapper 폴더가 앞선 PATH를 더한 사본.
export function evalPlan(plan: unknown, extras: Extras): unknown {
  const base = plan as { env?: Record<string, string> };
  return {
    ...base,
    env: {
      ...base.env,
      LOPHN_DAEMON_URL: extras.daemonUrl,
      LOPHN_EVAL_COMMAND_LOG: extras.commandLog,
      PATH: `${extras.binDir}:${extras.path}`,
    },
  };
}
