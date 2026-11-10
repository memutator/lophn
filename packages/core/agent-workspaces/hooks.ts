import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import process from "node:process";
import { errorCode, ok } from "../../base/mod.ts";
import {
  type AgentId,
  isLophn,
  type Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import { recordBeforeWrite } from "../lophn-agent/session/rewind/record.ts";
import { rewindOverCore } from "../lophn-agent/session/rewind/runtime-port.ts";
import type { FileHooks } from "../lophn-agent/tools/ports.ts";
import { agentMemoryFile } from "../lophn-agent/agents/store.ts";
import { memoryFileOf, workspaceMemoryFile } from "./workspace/data-folder.ts";

// agent runtime child의 data root(LOPHN_HOME)다. 절대 path가 아니면 memory 자리를 알 수 없다.
function dataRoot(): string | null {
  const home = process.env.LOPHN_HOME;
  return home !== undefined && isAbsolute(home) ? home : null;
}

// file.write와 file.edit에 workspace 층(`agent-workspaces`)이 끼우는 규칙이다: 쓰기 전에 pre-image를 남긴다(기록이 실패해도 쓰기는 막지
// 않는다). 지침 파일(LOPHN.md)도 묻지 않고 쓰고 rewind로 되돌린다. agent 정의는 lophn data에 있어 file tool이
// 닿지 않는다. agent.memory도 같은 길로 쓰기를 남긴다.
export const FILE_HOOKS: FileHooks = {
  async aroundWrite(ctx, target, run) {
    const written = await recordBeforeWrite(rewindOverCore(ctx.core), {
      session: ctx.session,
      turn: ctx.turn,
      tool_call: ctx.tool_call,
      root: target.root,
      path: target.relative,
      moved_from: null,
      run,
    });
    return written.ok ? ok(undefined) : written;
  },
  memoryFile(agent) {
    const root = dataRoot();
    return root === null ? null : memoryFileOf(root, agent);
  },
};

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "";
    throw error;
  }
}

// session 첫 turn에 prompt로 싣는 memory 글이다. workspace memory는 그 workspace의 모든 agent가 받고, agent memory는
// 사람이 만든 agent만 갖는다. 파일이 없으면 빈 글이다. 읽지 못한 파일은 빈 글로 본다: memory가 없다고 turn을 막지 않는다.
export async function readMemoryTexts(
  agent: AgentId,
  workspace: Workspace | null,
): Promise<{ workspace: string; agent: string }> {
  const root = dataRoot();
  if (root === null) return { workspace: "", agent: "" };
  const safe = (path: string) => readOrEmpty(path).catch(() => "");
  return {
    workspace: await safe(workspaceMemoryFile(root, workspace)),
    agent: isLophn(agent) ? "" : await safe(agentMemoryFile(root, agent)),
  };
}
