import { ok } from "../../base/mod.ts";
import { recordBeforeWrite } from "../lophn-agent/session/rewind/record.ts";
import { rewindOverCore } from "../lophn-agent/session/rewind/runtime-port.ts";
import { settingsEditIntent } from "../lophn-agent/tool-judgment/mod.ts";
import type { FileHooks } from "../lophn-agent/tools/ports.ts";

// 지침 파일은 LOPHN.md뿐이다. agent 정의는 lophn data에 있어 file tool이 닿지 않는다. PM은 project 층 skill 폴더를 쓴다.
export function isInstructionFile(path: string): boolean {
  return path.split(/[\\/]/).pop() === "LOPHN.md";
}

// file.write와 file.edit에 role 층이 끼우는 규칙이다: 지침 파일 쓰기는 설정 고치기라 Gate에 먼저 묻고,
// 쓰기 전에 pre-image를 남긴다(기록이 실패해도 쓰기는 막지 않는다).
export const FILE_HOOKS: FileHooks = {
  writeGate(path, ctx) {
    if (!isInstructionFile(path)) return null;
    const intent = settingsEditIntent({
      what: "instructions",
      id: null,
      session: ctx.session,
      turn: ctx.turn,
      toolCall: ctx.tool_call,
      agent: ctx.agent,
    });
    return {
      kind: intent.kind,
      target: intent.target,
      effect: intent.effect,
      input: intent.input,
    };
  },
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
};
