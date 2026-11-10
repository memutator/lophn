import { appGet } from "../../protocol/apps/apps.ts";
import { agentList } from "../../protocol/lophn-agent/agent-definitions.ts";
import { projectApi } from "../../protocol/projects/mod.ts";
import { type CoreCall, readOf } from "../lophn-agent/run-loop/core-call.ts";

// memory는 앱·project·agent를 이름과 id로 적는다. 이름과 slug는 바뀌거나 지운 뒤 다시 쓰이므로, 싣는 때 id마다 지금 이름을
// 붙인다. agent는 이것을 보고 사람에게 지금 이름으로 말하고, call에 slug를 쓰고, 지운 것의 note를 지운다. memory file은
// 고치지 않는다(agent.memory의 old_string 대조가 file 그대로의 글을 본다).
const ID = /\b(?:app|prj|agt)_[0-9a-z]{26}\b/g;

// prompt 안의 글이라 앞쪽만 푼다.
const MAX_IDS = 40;

export async function memoryNames(
  call: CoreCall,
  texts: readonly string[],
): Promise<string> {
  const ids = [...new Set(texts.flatMap((text) => text.match(ID) ?? []))]
    .sort()
    .slice(0, MAX_IDS);
  if (ids.length === 0) return "";
  let agents: Map<string, { name: string; handle: string }> | null | undefined;
  const agentOf = async (id: string) => {
    if (agents === undefined) {
      const listed = await readOf(call, agentList, {});
      agents = listed.ok
        ? new Map(listed.value.agents.map((row) => [row.agent, row]))
        : null;
    }
    return agents === null ? undefined : (agents.get(id) ?? null);
  };
  const lines: string[] = [];
  for (const id of ids) {
    const line = await lineOf(call, id, agentOf);
    if (line !== undefined) lines.push(`- ${id}: ${line}`);
  }
  return lines.join("\n");
}

// 읽지 못한 id(not_found 밖의 오류)는 줄을 내지 않는다. 지운 것으로 잘못 알리면 agent가 맞는 note를 지운다.
async function lineOf(
  call: CoreCall,
  id: string,
  agentOf: (
    id: string,
  ) => Promise<{ name: string; handle: string } | null | undefined>,
): Promise<string | undefined> {
  if (id.startsWith("app_")) {
    const read = await readOf(call, appGet, { app: id as never });
    if (!read.ok) return gone(read.error.code, "app");
    const app = read.value.app;
    const archived = app.status === "archived" ? ", archived" : "";
    return `app ${app.name}, slug ${app.slug}${archived}`;
  }
  if (id.startsWith("prj_")) {
    const read = await readOf(call, projectApi.get, { project: id as never });
    if (!read.ok) return gone(read.error.code, "project");
    const project = read.value.project;
    const archived = project.status === "archived" ? ", archived" : "";
    return `project ${project.title}, name ${project.name}${archived}`;
  }
  const agent = await agentOf(id);
  if (agent === undefined) return undefined;
  return agent === null
    ? "deleted agent"
    : `agent ${agent.name}, handle ${agent.handle}`;
}

function gone(code: string, what: string): string | undefined {
  return code === "not_found" ? `deleted ${what}` : undefined;
}
