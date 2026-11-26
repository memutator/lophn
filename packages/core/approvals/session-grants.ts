import type { Clock, IdSource } from "../../base/mod.ts";
import type {
  GateCall,
  PermissionCategory,
  PermissionDenial,
  PermissionRuleLayers,
  RecentDenial,
  SessionGrant,
  TurnRequest,
} from "../../protocol/approvals/mod.ts";
import {
  alwaysPatterns,
  matchesSessionGrant,
  scanShellCommand,
} from "./gate/mod.ts";

export const MAX_RECENT_DENIALS_PER_SESSION = 50;

export type SessionGrantInput = {
  readonly category: PermissionCategory;
  readonly pattern: string;
  readonly label: string;
};

export type SessionGrantStore = {
  grant(session: string, input: SessionGrantInput): SessionGrant;
  matches(
    session: string,
    call: GateCall,
    options?: { homeDir?: string },
  ): boolean;
  list(session: string): SessionGrant[];
  revoke(session: string, grantId: string): boolean;
  openedFolders(session: string): string[];
  recordDenial(
    session: string,
    entry: {
      readonly turn: string;
      readonly tool_call: string;
      readonly denial: PermissionDenial;
    },
  ): RecentDenial;
  recentDenials(session: string): RecentDenial[];
  clear(session: string): void;
};

// `session` 선택지를 골랐을 때 이 대화 동안 허락할 항목을 request에서 만든다.
export function sessionGrantInputForRequest(
  request: TurnRequest,
  layers: PermissionRuleLayers,
  homeDir?: string,
  dataRoot?: string,
): SessionGrantInput | null {
  const { subject } = request;
  switch (subject.kind) {
    case "file_read":
      if (subject.sensitive) return null;
      return {
        category: subject.outside_workspace ? "file_outside" : "file_read",
        pattern: subject.folder,
        label: subject.folder,
      };
    case "file_write":
      if (subject.sensitive) return null;
      return {
        category: subject.outside_workspace ? "file_outside" : "file_write",
        pattern: subject.folder,
        label: subject.folder,
      };
    case "shell": {
      const scan = scanShellCommand(subject.command, homeDir);
      if (scan.opaque || scan.elevated) return null;
      const safe = alwaysPatterns(layers, subject.command, homeDir, dataRoot);
      const pattern = safe.length === 1 ? safe[0] : scan.normalized;
      if (pattern === "") return null;
      return {
        category: "shell",
        pattern,
        label: pattern,
      };
    }
    case "mcp_tool":
      return {
        category: "mcp_tool",
        pattern: `${subject.server}/${subject.tool}`,
        label: `${subject.server}/${subject.tool}`,
      };
    case "app_tool":
      return {
        category: "app_tool",
        pattern: `${subject.app}/${subject.tool}`,
        label: subject.tool,
      };
    default:
      return null;
  }
}

// core 메모리에만 사는 session 단위 허락·거부 기록. session 끝·재시작에 사라지고 fork에 가지 않는다.
export function createSessionGrantStore(deps: {
  readonly clock: Clock;
  readonly ids: IdSource;
}): SessionGrantStore {
  const grantsBySession = new Map<string, SessionGrant[]>();
  const denialsBySession = new Map<string, RecentDenial[]>();

  return {
    grant(session, input) {
      let list = grantsBySession.get(session);
      if (!list) {
        list = [];
        grantsBySession.set(session, list);
      }
      const existing = list.find(
        (item) =>
          item.category === input.category && item.pattern === input.pattern,
      );
      if (existing) return existing;

      const created: SessionGrant = {
        id: deps.ids.newId("grt"),
        session,
        category: input.category,
        pattern: input.pattern,
        label: input.label,
        created_at: deps.clock.now(),
      };
      list.push(created);
      return created;
    },

    matches(session, call, options) {
      const list = grantsBySession.get(session);
      if (!list || list.length === 0) return false;
      return matchesSessionGrant(list, call, options);
    },

    list(session) {
      return [...(grantsBySession.get(session) ?? [])];
    },

    revoke(session, grantId) {
      const list = grantsBySession.get(session);
      if (!list) return false;
      const idx = list.findIndex((item) => item.id === grantId);
      if (idx === -1) return false;
      list.splice(idx, 1);
      if (list.length === 0) grantsBySession.delete(session);
      return true;
    },

    openedFolders(session) {
      const list = grantsBySession.get(session);
      if (!list) return [];
      const folders = new Set<string>();
      for (const item of list) {
        if (item.category === "file_outside") {
          folders.add(item.pattern);
        }
      }
      return [...folders];
    },

    recordDenial(session, entry) {
      let list = denialsBySession.get(session);
      if (!list) {
        list = [];
        denialsBySession.set(session, list);
      }
      const recorded: RecentDenial = {
        id: deps.ids.newId("ntc"),
        turn: entry.turn,
        tool_call: entry.tool_call,
        at: deps.clock.now(),
        denial: entry.denial,
      };
      list.push(recorded);
      if (list.length > MAX_RECENT_DENIALS_PER_SESSION) {
        list.splice(0, list.length - MAX_RECENT_DENIALS_PER_SESSION);
      }
      return recorded;
    },

    recentDenials(session) {
      return [...(denialsBySession.get(session) ?? [])];
    },

    clear(session) {
      grantsBySession.delete(session);
      denialsBySession.delete(session);
    },
  };
}
