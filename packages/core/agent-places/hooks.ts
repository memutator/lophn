import { ok } from "../../base/mod.ts";
import { recordBeforeWrite } from "../lophn-agent/session/rewind/record.ts";
import { rewindOverCore } from "../lophn-agent/session/rewind/runtime-port.ts";
import type { FileHooks } from "../lophn-agent/tools/ports.ts";

// file.write와 file.edit에 place 층(`agent-places`)이 끼우는 규칙이다: 쓰기 전에 pre-image를 남긴다(기록이 실패해도 쓰기는 막지
// 않는다). 지침 파일(LOPHN.md)도 묻지 않고 쓰고 rewind로 되돌린다. agent 정의는 lophn data에 있어 file tool이
// 닿지 않는다.
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
};
