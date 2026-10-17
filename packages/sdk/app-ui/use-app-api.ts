import { useCallback, useRef, useState } from "react";
import type { AppApiDeclaration } from "@lophn/blueprint";

// 버튼이 쓰는 blueprint app-api 선언.
export type AppApiSpec = Pick<AppApiDeclaration, "key" | "label">;

export type AppApiInput =
  | null
  | boolean
  | number
  | string
  | AppApiInput[]
  | { [key: string]: AppApiInput };

// 앱 view preload bridge `lophnApp`의 SDK 쪽 사본. 실패는 "<code>: <message>" Error로 온다.
export interface AppBridge {
  call(api: string, input: AppApiInput): Promise<unknown>;
}

export function appBridge(): AppBridge | undefined {
  return (globalThis as { lophnApp?: AppBridge }).lophnApp;
}

export type AppApiState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; value: unknown }
  | { status: "failed"; code: string };

export type AppApiResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string };

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^([a-z_]+):/.exec(message)?.[1] ?? "unavailable";
}

export interface UseAppApi {
  state: AppApiState;
  // 기다리는 동안 다시 부르면 아무것도 하지 않고 undefined다.
  run: (input: AppApiInput) => Promise<AppApiResult | undefined>;
}

// app-api 하나를 `lophnApp.call`로만 부르고 pending·결과·실패 code를 둔다.
export function useAppApi(
  api: Pick<AppApiSpec, "key">,
  app: AppBridge | undefined = appBridge(),
): UseAppApi {
  const [state, setState] = useState<AppApiState>({ status: "idle" });
  const running = useRef(false);
  const run = useCallback(async (input: AppApiInput) => {
    if (running.current) return undefined;
    running.current = true;
    setState({ status: "pending" });
    let result: AppApiResult;
    try {
      if (!app) throw new Error("unavailable: app bridge is unavailable");
      result = { ok: true, value: await app.call(api.key, input) };
      setState({ status: "done", value: result.value });
    } catch (error) {
      result = { ok: false, code: codeOf(error) };
      setState({ status: "failed", code: result.code });
    } finally {
      running.current = false;
    }
    return result;
  }, [app, api.key]);
  return { state, run };
}
