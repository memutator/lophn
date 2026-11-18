import type { CoreReply } from "../ipc/core-api.ts";
import {
  type LophnMachinesApi,
  MACHINES_CHANGED_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_LIST_CHANNEL,
  type MachineList,
  machineListSchema,
  type MachinesFailure,
} from "../ipc/machines.ts";
import type { BrowserTransport } from "./browser-api.ts";

async function invoke<T>(
  transport: BrowserTransport,
  channel: string,
  input?: unknown,
): Promise<T | MachinesFailure> {
  try {
    return (await transport.invoke(channel, input)) as T | MachinesFailure;
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

async function invokeCore(
  transport: BrowserTransport,
  channel: string,
  input: unknown,
): Promise<CoreReply> {
  try {
    return (await transport.invoke(channel, input)) as CoreReply;
  } catch {
    return {
      ok: false,
      error: { code: "unavailable", message: "main did not answer" },
    };
  }
}

export function createMachinesApi(
  transport: BrowserTransport,
): LophnMachinesApi {
  return Object.freeze({
    async list() {
      const reply = await invoke<MachineList>(transport, MACHINES_LIST_CHANNEL);
      // A list has no `ok`; a refusal is `{ ok: false, code }`.
      if ("ok" in reply) throw new Error(reply.code);
      return reply;
    },
    onChanged(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        const parsed = machineListSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      transport.on(MACHINES_CHANGED_CHANNEL, callback);
      return () => transport.removeListener(MACHINES_CHANGED_CHANNEL, callback);
    },
    cloneHere: (input) =>
      invokeCore(transport, MACHINES_CLONE_HERE_CHANNEL, input),
  } satisfies LophnMachinesApi);
}
