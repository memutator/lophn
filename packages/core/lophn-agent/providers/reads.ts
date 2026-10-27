import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  providerList,
  providerRead,
  type ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { listProviders, loadProvider } from "./store.ts";

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "provider not found" });
}

// provider는 읽힌 자체를 화면 값으로 준다. credential 값은 열에 없고 참조만 있다.
function publicProvider(record: ProviderRecord): ProviderRecord {
  return record;
}

function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_id?: unknown };
    if (typeof parsed["after_id"] !== "string") return invalidCursor();
    return ok(parsed["after_id"]);
  } catch {
    return invalidCursor();
  }
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid provider cursor" });
}

function cursorOf(afterId: string): string {
  const bytes = new TextEncoder().encode(canonicalize({ after_id: afterId }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function createProviderReads(): {
  read: ReadDefinition<typeof providerRead>;
  list: ReadDefinition<typeof providerList>;
} {
  return {
    read: {
      route: providerRead,
      handle(snapshot, _ctx, input) {
        const loaded = loadProvider(snapshot.sql, input.provider);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) return notFound();
        return ok({
          provider: publicProvider(loaded.value),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: providerList,
      handle(snapshot, _ctx, input) {
        const loaded = listProviders(snapshot.sql);
        if (!loaded.ok) return loaded;
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const start =
          after.value === null
            ? 0
            : loaded.value.findIndex((record) => record.id === after.value) + 1;
        if (after.value !== null && start === 0) {
          return invalidCursor();
        }
        const page = loaded.value.slice(start, start + PAGE);
        const next = start + page.length;
        return ok({
          providers: page.map(publicProvider),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            next < loaded.value.length
              ? cursorOf(page[page.length - 1]!.id)
              : null,
        });
      },
    },
  };
}
