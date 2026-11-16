import type { CoreReply } from "../ipc/core-api.ts";
import {
  type LophnMachinesApi,
  MACHINES_CHANGED_CHANNEL,
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_LIST_CHANNEL,
  MACHINES_OPEN_CHANNEL,
  MACHINES_PAIR_CHANNEL,
  MACHINES_REMOVE_CHANNEL,
  MACHINES_RENAME_CHANNEL,
  MACHINES_START_CHANNEL,
  MACHINES_THIS_READ_CHANNEL,
  MACHINES_THIS_WINDOW_CHANNEL,
  type MachineList,
  machineListSchema,
  type MachinePairReply,
  type MachinesFailure,
  type MachinesReply,
  type MachineWindow,
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
    async pair(text) {
      const reply = await invoke<MachinePairReply>(
        transport,
        MACHINES_PAIR_CHANNEL,
        { text },
      );
      if ("code" in reply) {
        return {
          ok: false,
          reason:
            reply.code === "invalid_input" ? "invalid_text" : "unavailable",
        };
      }
      return reply;
    },
    remove: (machine) =>
      invoke<MachinesReply>(transport, MACHINES_REMOVE_CHANNEL, { machine }),
    rename: (machine, alias) =>
      invoke<MachinesReply>(transport, MACHINES_RENAME_CHANNEL, {
        machine,
        alias,
      }),
    setStart: (start) =>
      invoke<MachinesReply>(transport, MACHINES_START_CHANNEL, start),
    open: (machine, session) =>
      invoke<MachinesReply>(
        transport,
        MACHINES_OPEN_CHANNEL,
        session === undefined ? { machine } : { machine, session },
      ),
    async thisWindow() {
      const reply = await invoke<MachineWindow>(
        transport,
        MACHINES_THIS_WINDOW_CHANNEL,
      );
      // A refusal reads as a window of this computer.
      return "ok" in reply ? { machine: null } : reply;
    },
    thisRead: (route, input) =>
      invokeCore(transport, MACHINES_THIS_READ_CHANNEL, { route, input }),
    cloneHere: (input) =>
      invokeCore(transport, MACHINES_CLONE_HERE_CHANNEL, input),
  } satisfies LophnMachinesApi);
}
