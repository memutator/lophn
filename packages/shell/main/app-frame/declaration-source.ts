// 앱 view의 고정 선언을 core의 `apps/tools`로 읽는다. 읽는 release는 view가 묶인 것이라
// 지금 active release가 달라도 view가 보는 선언 그대로다. release 없는 preview는 이 read로 알 수
// 없어 unavailable이다.
import { type CallResult, failure, type Outcome } from "./app-connection.ts";
import type { AppDeclaration, DeclarationSource } from "./app-call.ts";

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

export function createDeclarationSource(
  read: DeclarationRead,
): DeclarationSource {
  return async (view): Promise<Outcome<AppDeclaration>> => {
    if (view.mode !== "live" || view.release === null) {
      return failure("unavailable", "declaration is not available");
    }
    const found = await readDeclaration(read, view.app, view.release);
    if (!found.ok) return found;
    const operations = found.value.operations;
    if (!Array.isArray(operations)) {
      return failure("unavailable", "declaration is not available");
    }
    return {
      ok: true,
      value: {
        operations: operations.map((item) => {
          const operation = record(item) ?? {};
          return {
            name: String(operation.name),
            title: String(operation.title),
            effect: operation.effect as "read" | "write" | "external",
          };
        }),
      },
    };
  };
}

/** release의 전용 창 screen. 선언에 `full` 크기로 적힌 첫 screen이다. */
export function createEntryScreen(
  read: DeclarationRead,
): (app: string, release: string) => Promise<Outcome<string>> {
  return async (app, release) => {
    const found = await readDeclaration(read, app, release);
    if (!found.ok) return found;
    const screens = Array.isArray(found.value.screens)
      ? found.value.screens
      : [];
    const full = screens
      .map((item) => record(item) ?? {})
      .find(
        (screen) =>
          Array.isArray(screen.sizes) &&
          screen.sizes.includes("full") &&
          typeof screen.key === "string",
      );
    return full === undefined
      ? failure("unavailable", "the app has no full screen")
      : { ok: true, value: full.key as string };
  };
}
