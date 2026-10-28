import type { Result } from "../../../base/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/mod.ts";
import type { AgentFileSystem } from "../../lophn-agent/agents/ports.ts";
import { createAgentStore } from "../../lophn-agent/agents/store.ts";
import { ROLE_TABLE } from "./role-table.ts";

// built-in agent의 정의 파일을 만들어 둔다. 파일이 이미 있으면 그대로다(여러 번 불러도 하나다).
// 정의는 파일이라 SQL transaction에 묶을 수 없다. 호출하는 쪽이 등록이 commit된 뒤에 부르는 것이 바르고,
// project 등록처럼 같은 tx 안에서 부르면 파일 쓰기가 실패할 때 등록도 되돌아가는 대신 만들다 만 파일이
// 남을 수 있다(빈 파일이라 해가 없고 다음 호출이 이어 만든다).

type EnsureDeps = { files: AgentFileSystem; root: string };

function ensure(deps: EnsureDeps, ref: AgentRef): Result<void> {
  const store = createAgentStore(deps.files, deps.root, (place) =>
    ROLE_TABLE.agentsFolderOf(deps.root, place),
  );
  const slot = ROLE_TABLE.slotOf(deps.root, ref)!;
  const current = store.read(slot);
  if (!current.ok) return current;
  if (current.value !== null) return { ok: true, value: undefined };
  const written = store.write(slot, "");
  return written.ok ? { ok: true, value: undefined } : written;
}

// 첫 기동 때 lophn 정의가 없으면 만든다. lophn은 lophn 전체에 하나다.
export function ensureLophn(deps: EnsureDeps): Result<void> {
  return ensure(deps, { role: "lophn" });
}

// project마다 Project Manager 하나.
export function ensureProjectManager(
  deps: EnsureDeps,
  project: string,
): Result<void> {
  return ensure(deps, { role: "project_manager", project: project as never });
}

// 앱마다 App Engineer 하나.
export function ensureAppEngineer(deps: EnsureDeps, app: string): Result<void> {
  return ensure(deps, { role: "app_engineer", app: app as never });
}
