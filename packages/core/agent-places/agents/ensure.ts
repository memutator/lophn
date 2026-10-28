import type { Result } from "../../../base/mod.ts";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileSystem } from "../../lophn-agent/agents/ports.ts";
import {
  agentSlotOf,
  createAgentStore,
} from "../../lophn-agent/agents/store.ts";

// 첫 기동 때 lophn 모양의 빈 정의를 만들어 둔다. 다른 agent는 등록할 때 만들지 않는다.
type EnsureDeps = { files: AgentFileSystem; root: string };

export function ensureLophn(deps: EnsureDeps): Result<void> {
  const store = createAgentStore(deps.files, deps.root);
  const slot = agentSlotOf(deps.root, LOPHN_AGENT_ID);
  const current = store.read(slot);
  if (!current.ok) return current;
  if (current.value !== null) return { ok: true, value: undefined };
  const written = store.write(slot, "");
  return written.ok ? { ok: true, value: undefined } : written;
}
