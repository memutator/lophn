import { useCallback, useRef, useState } from "react";
import type { OperationDeclaration } from "@lophn/declaration";

// 버튼이 쓰는 선언의 operation.
export type OperationSpec = Pick<OperationDeclaration, "name" | "title">;

export type OperationInput =
  | null
  | boolean
  | number
  | string
  | OperationInput[]
  | { [key: string]: OperationInput };

// 앱 view preload bridge `lophnApp`의 SDK 쪽 사본. 실패는 "<code>: <message>" Error로 온다.
export interface AppBridge {
  callOperation(operation: string, input: OperationInput): Promise<unknown>;
}

export function appBridge(): AppBridge | undefined {
  return (globalThis as { lophnApp?: AppBridge }).lophnApp;
}

export type OperationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; value: unknown }
  | { status: "failed"; code: string };

export type OperationResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string };

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^([a-z_]+):/.exec(message)?.[1] ?? "unavailable";
}

export interface UseOperation {
  state: OperationState;
  // 기다리는 동안 다시 부르면 아무것도 하지 않고 undefined다.
  run: (input: OperationInput) => Promise<OperationResult | undefined>;
}

// operation 하나를 `lophnApp.callOperation`으로만 부르고 pending·결과·실패 code를 둔다.
export function useOperation(
  operation: Pick<OperationSpec, "name">,
  app: AppBridge | undefined = appBridge(),
): UseOperation {
  const [state, setState] = useState<OperationState>({ status: "idle" });
  const running = useRef(false);
  const run = useCallback(
    async (input: OperationInput) => {
      if (running.current) return undefined;
      running.current = true;
      setState({ status: "pending" });
      let result: OperationResult;
      try {
        if (!app) throw new Error("unavailable: app bridge is unavailable");
        result = {
          ok: true,
          value: await app.callOperation(operation.name, input),
        };
        setState({ status: "done", value: result.value });
      } catch (error) {
        result = { ok: false, code: codeOf(error) };
        setState({ status: "failed", code: result.code });
      } finally {
        running.current = false;
      }
      return result;
    },
    [app, operation.name],
  );
  return { state, run };
}
