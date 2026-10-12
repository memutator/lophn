// composer의 `/` 명령(lophn-agent/commands). 목록은 그 session의 agent 기준 registry를 core에서 읽어 묶음과
// 거르기 규칙(contracts의 command-filter)에 먹인 것이다. registry는 session이 있어야 계산된다.
import type { CommandEntry } from "../../../../packages/contracts/lophn-agent/commands.ts";
import { listCommands } from "../../../../packages/contracts/lophn-agent/command-filter.ts";
import type { SlashGroupView } from "./slash-menu/types.ts";
import type { SourceResult } from "./agent-source.ts";
import type { AgentEnv } from "./agent-core-source-env.ts";
import type { SessionValue } from "./agent-core-source-values.ts";

/** session이 있어야 쓸 수 있는 전역 명령. session이 없는 화면의 목록에서 뺀다. */
const NEEDS_SESSION = new Set(["rename", "archive", "compact", "fork"]);

/**
 * session이 하나도 없는 agent의 목록. registry는 session을 기준으로 계산되어 core에 물을 수 없으므로,
 * 어느 agent에나 같은 전역 명령 가운데 session 없이 쓰는 것만 둔다(lophn-agent/commands#R2의 표와 같은 글).
 */
const GLOBAL_WITHOUT_SESSION: readonly CommandEntry[] = [
  ["new", "New session", "Start a new session with this agent"],
  ["mcp", "MCP", "Show MCP server status"],
  ["skills", "Skills", "Turn skills on or off for this agent"],
  ["permissions", "Permissions", "Change what this agent may do"],
].map(([name, title, description]): CommandEntry => ({
  name: name!,
  title: title!,
  description: description!,
  source: "builtin",
  skill_origin: null,
  while_running: "run",
  action: { kind: "builtin", id: name as "new" },
}));

interface RegistryValue {
  commands: CommandEntry[];
}

/** 그 session의 registry. */
export async function readRegistry(
  env: AgentEnv,
  session: string,
): Promise<SourceResult<readonly CommandEntry[]>> {
  const read = await env.link.read<RegistryValue>("commands", "list", {
    session,
  });
  return read.ok ? { ok: true, value: read.value.commands } : read;
}

export async function readCommands(
  env: AgentEnv,
  session: string | null,
  query: string,
  agentName: () => Promise<string>,
): Promise<SourceResult<SlashGroupView[]>> {
  let entries: readonly CommandEntry[];
  if (session !== null) {
    const registry = await readRegistry(env, session);
    if (!registry.ok) return registry;
    entries = registry.value;
  } else if (env.target.place.kind === "global") {
    entries = GLOBAL_WITHOUT_SESSION;
  } else {
    // 같은 agent의 열린 session 하나의 registry에서 role 명령과 skill까지 가져온다.
    const listed = await env.link.pages<SessionValue>("sessions", "list", {
      assignment: env.target.assignment,
      work_place: { kind: env.target.place.kind, id: env.target.place.id },
    }, "sessions");
    if (!listed.ok) return listed;
    const open = listed.value.find((item) => item.state === "open");
    if (open === undefined) {
      entries = GLOBAL_WITHOUT_SESSION;
    } else {
      const registry = await readRegistry(env, open.id);
      if (!registry.ok) return registry;
      entries = registry.value.filter((entry) =>
        !(entry.source === "builtin" && NEEDS_SESSION.has(entry.name))
      );
    }
  }
  const groups = listCommands({ entries }, await agentName(), query);
  return {
    ok: true,
    value: groups.map((group) => ({
      source: group.source,
      title: group.title,
      entries: group.entries.map((entry) => ({
        name: entry.name,
        title: entry.title,
        description: entry.description,
        source: entry.source,
        skillOrigin: entry.skill_origin,
        whileRunning: entry.while_running,
      })),
    })),
  };
}
