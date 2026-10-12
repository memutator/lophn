// NotificationsSource를 main의 core 통로로 만든다. 설정 값은 settings read(get)·command(apply)다.
// OS notification opt-in 값은 사람이 켰을 때만 켜진다.
import type { CoreCall } from "../../../../../ipc/core.ts";
import type { CoreSource } from "../../../connection/connection.ts";
import { OS_NOTIFICATIONS_KEY } from "../../../../../ipc/notifications.ts";
import type {
  NotificationsSource,
  NotificationsView,
  SourceResult,
} from "./source.ts";

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

interface EffectiveValue {
  key: string;
  resolved: boolean;
  value: unknown;
  source_layer: "builtin" | "common" | null;
}

export function coreNotificationsSource(
  core: CoreSource,
): NotificationsSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async notifications() {
      const read = await call<{
        settings: EffectiveValue[];
        revision: number;
        defaults_revision: string;
      }>(core, "read", "settings", "get", { keys: [OS_NOTIFICATIONS_KEY] });
      if (!read.ok) return read;
      const found = read.value.settings.find(
        (setting) => setting.key === OS_NOTIFICATIONS_KEY,
      );
      const value = found?.value;
      const view: NotificationsView = {
        enabled: typeof value === "boolean" ? value : null,
        revision: read.value.revision,
        defaultsRevision: read.value.defaults_revision,
      };
      return { ok: true, value: view };
    },

    async setNotifications(view, enabled) {
      const result = await call<{
        revision: number;
        changed: boolean;
      }>(core, "command", "settings", "apply", {
        input: {
          changes: [{
            layer: "common",
            key: OS_NOTIFICATIONS_KEY,
            action: "set",
            value: enabled,
          }],
        },
        idempotency_key: `os-notifications-${view.revision}-${String(enabled)}`,
        compare: {
          revision: view.revision,
          defaults_revision: view.defaultsRevision,
        },
        prepared: [],
      });
      return result.ok ? { ok: true, value: null } : result;
    },
  };
}
