import { err, ok, type Result } from "../../../base/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
import { contextListRoute } from "../../../protocol/projects/mod.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";

const MAX_CONTEXT_PAGES = 50;

// 이 place의 agent가 읽을 active context다. project place는 그 project의 context 전부이고, 그 밖에는
// context 자료가 없다.
export async function activeContextsOf(
  machine: CoreCall,
  place: Place | null,
): Promise<Result<string[]>> {
  if (place === null || place.kind !== "project") return ok([]);
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CONTEXT_PAGES; page += 1) {
    const listed = await readOf(machine, contextListRoute, {
      project: place.id,
      status: "active",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const context of listed.value.contexts) {
      if (context.status === "active") ids.push(context.id);
    }
    if (listed.value.next_cursor === null) return ok(ids);
    cursor = listed.value.next_cursor;
  }
  return err({ code: "unavailable", message: "the context list is too long" });
}
