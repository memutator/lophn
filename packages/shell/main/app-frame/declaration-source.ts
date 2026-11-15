// 앱 전용 창의 screen을 release의 선언(core의 `apps/tools`)에서 읽는다.
import { type CallResult, failure, type Outcome } from "./app-connection.ts";

type DeclarationRead = (app: string, release: string) => Promise<CallResult>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** release의 선언. 읽지 못하거나 다른 release가 오면 실패다. */
async function readDeclaration(
  read: DeclarationRead,
  app: string,
  release: string,
): Promise<Outcome<Record<string, unknown>>> {
  const got = await read(app, release);
  if (!got.ok) return failure("unavailable", "declaration is not available");
  const declaration = record(got.value);
  if (declaration === undefined || declaration.release !== release) {
    return failure("conflict", "the app version changed");
  }
  return { ok: true, value: declaration };
}

/** release의 전용 창 screen. 선언에 `tab` 자리로 적힌 첫 screen이다. */
export function createEntryScreen(
  read: DeclarationRead,
): (app: string, release: string) => Promise<Outcome<string>> {
  return async (app, release) => {
    const found = await readDeclaration(read, app, release);
    if (!found.ok) return found;
    const screens = Array.isArray(found.value.screens)
      ? found.value.screens
      : [];
    const entry = screens
      .map((item) => record(item) ?? {})
      .find(
        (screen) =>
          Array.isArray(screen.places) &&
          screen.places.includes("tab") &&
          typeof screen.key === "string",
      );
    return entry === undefined
      ? failure("unavailable", "the app has no tab screen")
      : { ok: true, value: entry.key as string };
  };
}
