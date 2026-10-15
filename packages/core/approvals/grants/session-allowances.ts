import { canonicalize } from "../../../base/mod.ts";
import type { Intent } from "../../../protocol/approvals/mod.ts";
import type { SessionAllowances } from "../ports.ts";

// 같은 session의 같은 대상만 같은 key다. 허락을 줄 수 있는 대상이 아니면 null이다.
export function allowanceKey(intent: Intent): string | null {
  const target = intent.target;
  switch (target.kind) {
    case "app_api":
      return canonicalize(["app_api", target.app, target.api]);
    case "mcp_tool":
      return canonicalize(["mcp_tool", target.server, target.tool]);
    case "settings_edit":
      return canonicalize(["settings_edit", target.what, target.id]);
    default:
      return null;
  }
}

// 메모리에만 둔다. 재시작하면 사라지고, fork는 새 session id라 가져가지 않는다.
export function createSessionAllowances(): SessionAllowances {
  const bySession = new Map<string, Set<string>>();
  return {
    allow(session, key) {
      const keys = bySession.get(session) ?? new Set<string>();
      keys.add(key);
      bySession.set(session, keys);
    },
    has: (session, key) => bySession.get(session)?.has(key) ?? false,
    clear: (session) => {
      bySession.delete(session);
    },
  };
}
