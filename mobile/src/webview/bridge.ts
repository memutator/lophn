// Messages between the remote page (`globalThis.lophnRemote`, injected by the native view) and the shell.
// Both sides send JSON text. The page is untrusted bundle code, so the shell keeps only these kinds.
import { z } from "zod";
import type {
  ConnectionState,
  CoreEventMessage,
} from "../../../packages/shell/ipc/core.ts";
import type { CoreReply } from "../../../packages/shell/ipc/core-api.ts";

const id = z.string().min(1).max(64);
const name = z.string().regex(/^[a-z][a-z0-9_-]*$/);

// `call` is the desktop `CoreCall` with upload bytes as base64 (JSON only crosses the bridge).
const callSchema = z
  .strictObject({
    kind: z.enum(["read", "command", "memory", "upload", "file"]),
    resource: name,
    method: name,
    body: z.unknown(),
    base64: z.string().optional(),
  })
  .refine((call) => (call.kind === "upload") === (call.base64 !== undefined));

const pageMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("call"), id, call: callSchema }),
  z.strictObject({
    type: z.literal("watch"),
    id,
    conditions: z.array(
      z.strictObject({
        session: z.string().optional(),
        types: z.array(z.string()).optional(),
      }),
    ),
  }),
  // The page asks for the current connection state. It sends this once at document start.
  z.strictObject({ type: z.literal("state") }),
]);

export type PageMessage = z.infer<typeof pageMessageSchema>;

/**
 * Shell → page. `reply` answers a `call` or `watch` with the same id. A `file` call's value is
 * `{content_type, base64}`; the page turns it into the desktop `{bytes, contentType}`.
 */
export type ShellMessage =
  | { type: "reply"; id: string; reply: CoreReply }
  | { type: "event"; message: CoreEventMessage }
  | { type: "state"; state: ConnectionState };

/** Parses a page message. Anything that is not one of the page kinds is dropped (undefined). */
export function readPageMessage(data: string): PageMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = pageMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
