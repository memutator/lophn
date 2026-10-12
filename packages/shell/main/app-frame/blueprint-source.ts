// 앱 view의 고정 blueprint를 core의 `/v1/apps/blueprint`로 읽는다. 그 read는 앱의 active
// release blueprint 하나만 내므로, view가 묶인 release와 같을 때만 그 blueprint를 쓴다. 다르면
// (release가 바뀜) 다른 release의 선언으로 command를 판정하지 않는다. release 없는 preview는
// 이 read로 알 수 없어 unavailable이다.
import { type CallResult, failure, type Outcome } from "./app-connection.ts";
import type { Blueprint, BlueprintSource } from "./app-call.ts";

export type BlueprintRead = (app: string) => Promise<CallResult>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** active release의 blueprint. 읽지 못하거나 release가 다르면 실패다. */
async function activeBlueprint(
  read: BlueprintRead,
  app: string,
  release: string,
): Promise<Outcome<Record<string, unknown>>> {
  const got = await read(app);
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
    const found = await activeBlueprint(read, view.app, view.release);
    if (!found.ok) return found;
    const commands = found.value.commands;
    if (!Array.isArray(commands)) {
      return failure("unavailable", "blueprint is not available");
    }
    return {
      ok: true,
      value: {
        commands: commands.map((item) => {
          const command = record(item) ?? {};
          return {
            key: String(command.key),
            label: String(command.label),
            effect: command.effect as "read" | "write" | "external",
            confirm: command.confirm === true,
            input: command.input ?? null,
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
    const found = await activeBlueprint(read, app, release);
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
