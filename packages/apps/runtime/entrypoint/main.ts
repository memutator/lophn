// 앱 프로세스 진입점. exception observer를 앱 code load 전에 설치한다.
// observer specifier는 bundle 고정 import map이 해석하는 SDK specifier다.
import { systemClock } from "@lophn/base";
import { createIdSource } from "@lophn/base";
import { installCrashExit } from "./crash.ts";
import { startRuntime } from "./startup.ts";
import { startDirectServer } from "./direct-server.ts";
import type { Blueprint } from "../../blueprint/mod.ts";

const OBSERVER = "@lophn/cap-problem";
const APP = "@lophn/app";

type ObserverFactory = {
  createExceptionObserver: (deps: {
    now: () => string;
    newId: (prefix: string) => string;
    sleep: (ms: number) => Promise<void>;
    currentInvocation: () => null;
  }) => (transport: (input: unknown) => Promise<unknown>) => () => void;
};

export async function main(deps: {
  readLine: () => Promise<string | null>;
  importModule: (specifier: string) => Promise<unknown>;
  clock?: { now: () => string; nowMs: () => number };
  ids?: { newId: (prefix: string) => string };
  key: { verify: (payload: string, signature: string) => Promise<boolean> };
  blueprint: Blueprint;
  broker: (request: unknown) => Promise<{ status: number; body: unknown }>;
  dataSchema: number;
  reportTransport: (input: unknown) => Promise<unknown>;
  exit?: (code: number) => void;
  writeStderr?: (text: string) => void;
}): Promise<void> {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? createIdSource({
    clock,
    random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
  });
  const observer = await deps.importModule(OBSERVER) as ObserverFactory;
  const install = observer.createExceptionObserver({
    now: () => clock.now(),
    newId: (prefix) => ids.newId(prefix),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    currentInvocation: () => null,
  });
  install(deps.reportTransport);
  installCrashExit({
    report: () => deps.reportTransport({ kind: "crash" }).then(() => undefined),
    writeStderr: deps.writeStderr ??
      ((text) => Deno.stderr.writeSync(new TextEncoder().encode(text))),
    exit: deps.exit ?? ((code) => Deno.exit(code)),
  });
  const line = await deps.readLine();
  if (!line) throw new Error("app start input missing");
  const started = startRuntime({
    line,
    blueprint: deps.blueprint,
    key: deps.key,
    clock,
    ids,
    broker: deps.broker as never,
    dataSchema: deps.dataSchema,
  });
  await deps.importModule(APP);
  startDirectServer(started.state);
}

if (import.meta.main) {
  await main({
    readLine: () =>
      Deno.stdin.readable.getReader().read().then((result) =>
        result.value ? new TextDecoder().decode(result.value) : null
      ),
    importModule: (specifier) => import(specifier),
    key: { verify: () => Promise.resolve(false) },
    blueprint: { commands: [], screens: [] } as unknown as Blueprint,
    broker: () => Promise.resolve({ status: 503, body: null }),
    dataSchema: 0,
    reportTransport: () => Promise.resolve(undefined),
  });
}
