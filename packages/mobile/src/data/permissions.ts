// Session permissions data calls and hook: reads `permissions/read` and revokes temporary session grants via
// `permissions/revoke-grant`. Pure request helpers have no React imports so Node tests can exercise them directly.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionPermissionsOutput,
  sessionGrantRevoke,
  sessionPermissionsRead,
} from "../../../protocol/approvals/permissions-view.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import { useStateChanged } from "../../../shell/renderer/desktop/connection/core-read.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { type Asked, ask } from "./ask.ts";

export type { SessionPermissionsOutput };

/** Reads the session's current permission mode, folders, rules, active grants, MCP trust, local tools, and recent denials. */
export async function readSessionPermissions(
  core: CoreSource,
  session: string,
): Promise<Asked<SessionPermissionsOutput>> {
  const reply = await ask(core, sessionPermissionsRead, { session });
  if (!reply.ok) return reply;
  const parsed = sessionPermissionsRead.output.safeParse(reply.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, code: "internal" };
}

/** Revokes one "Allow for this session" grant. */
export async function revokeSessionGrant(
  core: CoreSource,
  session: string,
  grant: string,
): Promise<Asked<{ revoked: boolean }>> {
  const reply = await ask(core, sessionGrantRevoke, { session, grant });
  if (!reply.ok) return reply;
  const parsed = sessionGrantRevoke.output.safeParse(reply.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, code: "internal" };
}

export interface SessionPermissionsState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly data: SessionPermissionsOutput | null;
  readonly revoking: string | null;
  readonly revokeError: string | null;
  reload(): void;
  revokeGrant(grantId: string): Promise<boolean>;
}

const PERMISSION_WATCH = ["sessions", "settings", "extension_settings"] as const;

/** Reads and follows `permissions/read` for an open session; pass null while the sheet is closed to avoid extra calls. */
export function useSessionPermissions(
  session: string | null,
): SessionPermissionsState {
  const core = useEventClient().core;
  const [status, setStatus] =
    useState<SessionPermissionsState["status"]>("idle");
  const [data, setData] = useState<SessionPermissionsOutput | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (session === null) {
      setStatus("idle");
      setData(null);
      setRevokeError(null);
      return;
    }
    const token = (seq.current += 1);
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    const read = await readSessionPermissions(core, session);
    if (token !== seq.current) return;
    if (read.ok) {
      setData(read.value);
      setStatus("ready");
    } else {
      setStatus("failed");
    }
  }, [core, session]);

  useEffect(() => {
    void load();
  }, [load]);

  useStateChanged(
    PERMISSION_WATCH,
    useCallback(() => {
      if (session !== null) void load();
    }, [session, load]),
  );

  const revokeGrant = useCallback(
    async (grantId: string): Promise<boolean> => {
      if (session === null) return false;
      setRevoking(grantId);
      setRevokeError(null);
      const reply = await revokeSessionGrant(core, session, grantId);
      setRevoking(null);
      if (!reply.ok) {
        setRevokeError("Couldn't revoke this grant. Try again.");
        return false;
      }
      void load();
      return true;
    },
    [core, session, load],
  );

  return {
    status,
    data,
    revoking,
    revokeError,
    reload: () => void load(),
    revokeGrant,
  };
}
