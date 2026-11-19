// Calls one core route and turns the reply (or a thrown transport error) into a Result that keeps the error code,
// message and reason the computer gave. Pure TypeScript without React or Expo so Node tests import it directly.
import type { z } from "zod";
import type {
  CommandRoute,
  MemoryRoute,
  ReadRoute,
  UploadRoute,
} from "../../../protocol/base/route.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";

export type AskRoute = ReadRoute | MemoryRoute | UploadRoute | CommandRoute;

export type Asked<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message?: string;
      readonly reason?: string;
    };

export async function ask<R extends ReadRoute | MemoryRoute>(
  core: CoreSource,
  route: R,
  body: z.input<R["input"]>,
): Promise<Asked<z.output<R["output"]>>>;
export async function ask<T = unknown>(
  core: CoreSource,
  route: AskRoute,
  body: unknown,
): Promise<Asked<T>>;
export async function ask(
  core: CoreSource,
  route: AskRoute,
  body: unknown,
): Promise<Asked<unknown>> {
  try {
    const reply = await core.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body,
    });
    if (reply.ok) return { ok: true, value: reply.value };
    const reason =
      typeof reply.error?.details?.reason === "string"
        ? reply.error.details.reason
        : undefined;
    return {
      ok: false,
      code: reply.error?.code ?? "unavailable",
      ...(reply.error?.message === undefined
        ? {}
        : { message: reply.error.message }),
      ...(reason === undefined ? {} : { reason }),
    };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
