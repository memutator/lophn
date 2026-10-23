import { useCallback, useRef, useState } from "react";
import type { ToolDeclaration } from "@lophn/declaration";

// 버튼이 쓰는 선언의 tool.
export type ToolSpec = Pick<ToolDeclaration, "name" | "title">;

export type ToolInput =
  | null
  | boolean
  | number
  | string
  | ToolInput[]
  | { [key: string]: ToolInput };

// 앱 view preload bridge `lophnApp`의 SDK 쪽 사본. 실패는 "<code>: <message>" Error로 온다.
export interface AppBridge {
  callTool(tool: string, input: ToolInput): Promise<unknown>;
}

export function appBridge(): AppBridge | undefined {
  return (globalThis as { lophnApp?: AppBridge }).lophnApp;
}

export type ToolState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; value: unknown }
  | { status: "failed"; code: string };

export type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string };

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^([a-z_]+):/.exec(message)?.[1] ?? "unavailable";
}

export interface UseTool {
  state: ToolState;
  // 기다리는 동안 다시 부르면 아무것도 하지 않고 undefined다.
  run: (input: ToolInput) => Promise<ToolResult | undefined>;
}

// tool 하나를 `lophnApp.callTool`로만 부르고 pending·결과·실패 code를 둔다.
export function useTool(
  tool: Pick<ToolSpec, "name">,
  app: AppBridge | undefined = appBridge(),
): UseTool {
  const [state, setState] = useState<ToolState>({ status: "idle" });
  const running = useRef(false);
  const run = useCallback(async (input: ToolInput) => {
    if (running.current) return undefined;
    running.current = true;
    setState({ status: "pending" });
    let result: ToolResult;
    try {
      if (!app) throw new Error("unavailable: app bridge is unavailable");
      result = { ok: true, value: await app.callTool(tool.name, input) };
      setState({ status: "done", value: result.value });
    } catch (error) {
      result = { ok: false, code: codeOf(error) };
      setState({ status: "failed", code: result.code });
    } finally {
      running.current = false;
    }
    return result;
  }, [app, tool.name]);
  return { state, run };
}
