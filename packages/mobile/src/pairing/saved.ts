// Reading what the phone saved, without expo, so Node tests read it too. The saved shapes carry no version: a newer app
// reads an older save field by field, and a wrong element is dropped alone instead of losing every computer.
import { z } from "zod";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type RosterSnapshot,
  rosterSnapshotSchema,
} from "../../../protocol/remote/roster.ts";
import type { Computer } from "../../../remote-client/mod.ts";

// Unknown fields go: a computer saved before the roster also had `device` (its own id for this phone, which the roster now
// gives) and `revoked`. `signing_key` is learnt again from the next `join` answer when absent.
const computerSchema = z.object({
  addresses: z.array(z.string()),
  port: z.number().int(),
  key: z.string().min(1),
  relay: z.string().optional(),
  // A bad id costs the id alone; the next hello gives it back.
  machine: z
    .string()
    .startsWith("mch_")
    .optional()
    .catch(undefined),
  signing_key: z.string().optional(),
  name: z.string().optional(),
  announced: z.string().optional(),
});

function json(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The saved computers (SecureStore `computers`). */
export function readComputers(text: string | null): Computer[] {
  const saved = json(text);
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((one: unknown) => {
    const parsed = computerSchema.safeParse(one);
    if (!parsed.success) return [];
    const { machine, ...rest } = parsed.data;
    return [
      machine === undefined ? rest : { ...rest, machine: machine as Id<"mch"> },
    ];
  });
}

/** The roster the phone holds (a file, not SecureStore: it outgrows a SecureStore value, and the signatures guard it). */
export function readRoster(text: string | null): RosterSnapshot {
  const parsed = rosterSnapshotSchema.safeParse(json(text));
  return parsed.success ? parsed.data : { statements: [], reach: [] };
}
