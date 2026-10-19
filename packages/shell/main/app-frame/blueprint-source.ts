// 앱 view의 고정 blueprint를 core의 `app.app_api`로 읽는다. 읽는 release는 view가 묶인 것이라
// 지금 active release가 달라도 view가 보는 선언 그대로다. release 없는 preview는 이 read로 알 수
// 없어 unavailable이다.
import { type CallResult, failure, type Outcome } from "./app-connection.ts";
import type { Blueprint, BlueprintSource } from "./app-call.ts";

type BlueprintRead = (
  app: string,
  release: string,
) => Promise<CallResult>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** release의 blueprint. 읽지 못하거나 다른 release가 오면 실패다. */
async function readBlueprint(
  read: BlueprintRead,
  app: string,
  release: string,
): Promise<Outcome<Record<string, unknown>>> {
  const got = await read(app, release);
  if (!got.ok) return failure("unavailable", "blueprint is not available");
  const blueprint = record(got.value);
  if (blueprint === undefined || blueprint.release !== release) {
    return failure("conflict", "the app version changed");
  }
  return { ok: true, value: blueprint };
}

export function createBlueprintSource(read: BlueprintRead): BlueprintSource {
  return async (view): Promise<Outcome<Blueprint>> => {
    if (view.mode !== "live" || view.release === null) {
      return failure("unavailable", "blueprint is not available");
    }
    const found = await readBlueprint(read, view.app, view.release);
    if (!found.ok) return found;
    const tools = found.value.tools;
    if (!Array.isArray(tools)) {
      return failure("unavailable", "blueprint is not available");
    }
    return {
      ok: true,
      value: {
        appApi: tools.map((item) => {
          const tool = record(item) ?? {};
          return {
            key: String(tool.name),
            label: String(tool.title),
            effect: tool.effect as "read" | "write" | "external",
            hasInput: tool.inputSchema !== null &&
              tool.inputSchema !== undefined,
          };
        }),
      },
    };
  };
}

/** release의 전용 창 screen. blueprint가 `full` 크기를 선언한 첫 screen이다. */
export function createEntryScreen(
  read: BlueprintRead,
): (app: string, release: string) => Promise<Outcome<string>> {
  return async (app, release) => {
    const found = await readBlueprint(read, app, release);
    if (!found.ok) return found;
    const screens = Array.isArray(found.value.screens)
      ? found.value.screens
      : [];
    const full = screens.map((item) => record(item) ?? {}).find((screen) =>
      Array.isArray(screen.sizes) && screen.sizes.includes("full") &&
      typeof screen.key === "string"
    );
    return full === undefined
      ? failure("unavailable", "the app has no full screen")
      : { ok: true, value: full.key as string };
  };
}
