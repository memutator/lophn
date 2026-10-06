import { useCallback, useRef, useState } from "react";
import type { CommandDeclaration } from "@lophn/blueprint";

// 버튼이 쓰는 blueprint command 선언. 확인 여부는 effect가 아니라 선언의 confirm이 정한다(apps/sdk#R19).
export type CommandSpec = Pick<CommandDeclaration, "key" | "label" | "confirm">;

export type CommandInput =
  | null
  | boolean
  | number
  | string
  | CommandInput[]
  | { [key: string]: CommandInput };

// 앱 view preload bridge `lophnApp`의 SDK 쪽 사본(contracts/shell app-bridge의 call). 실패는
// "<code>: <message>" Error로 온다. confirm command의 사람 확인은 lophn이 이 호출 안에서 받는다.
export interface AppBridge {
  call(command: string, input: CommandInput): Promise<unknown>;
}

export function appBridge(): AppBridge | undefined {
  return (globalThis as { lophnApp?: AppBridge }).lophnApp;
}

export type CommandState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; value: unknown }
  | { status: "failed"; code: string };

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string };

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^([a-z_]+):/.exec(message)?.[1] ?? "unavailable";
}

export interface UseCommand {
  state: CommandState;
  // 기다리는 동안 다시 부르면 아무것도 하지 않고 undefined다.
  run: (input: CommandInput) => Promise<CommandResult | undefined>;
}

// command 하나를 `lophnApp.call`로만 부르고 pending·결과·실패 code를 둔다.
export function useCommand(
  command: Pick<CommandSpec, "key">,
  app: AppBridge | undefined = appBridge(),
): UseCommand {
  const [state, setState] = useState<CommandState>({ status: "idle" });
  const running = useRef(false);
  const run = useCallback(async (input: CommandInput) => {
    if (running.current) return undefined;
    running.current = true;
    setState({ status: "pending" });
    let result: CommandResult;
    try {
      if (!app) throw new Error("unavailable: app bridge is unavailable");
      result = { ok: true, value: await app.call(command.key, input) };
      setState({ status: "done", value: result.value });
    } catch (error) {
      result = { ok: false, code: codeOf(error) };
      setState({ status: "failed", code: result.code });
    } finally {
      running.current = false;
    }
    return result;
  }, [app, command.key]);
  return { state, run };
}
