// What GuestScreen adds for an app that runs its backend on the phone: the app's database file, bound to the guest's
// origin for exactly as long as the guest is mounted (modules/lophn-app-db).
import { useLayoutEffect, useState } from "react";
import { bind, unbind } from "../../../modules/lophn-app-db/index.ts";

export type GuestAppDbProp = { path: string; record: boolean };

// The sandbox tells a module its guest's origin only when the module is a substitution, so the module stands in for
// itself. Without this entry a guest cannot reach the module.
export const APP_DB_SUBSTITUTION = { LophnAppDb: "LophnAppDb" };

/**
 * Binds `appDb` to `origin` before the guest may mount, and unbinds it on unmount (which closes the guest's
 * connection). Returns whether the guest may mount now: always without `appDb`.
 */
export function useAppDbBinding(origin: string, appDb: GuestAppDbProp | undefined): boolean {
  const path = appDb?.path;
  const record = appDb?.record ?? false;
  const [bound, setBound] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (path === undefined) return;
    bind(origin, path, { record });
    setBound(origin);
    return () => {
      unbind(origin);
      setBound(null);
    };
  }, [origin, path, record]);
  return path === undefined || bound === origin;
}
