// contracts#T10 E2E 실행. Deno test에서 Playwright로 Electron shell을 띄운다.
// Playwright는 npm:playwright를 Deno가 직접 불러 온다(Node package.json 예외는 쓰지 않는다).
// renderer DOM은 Chromium 원격 디버깅(CDP)으로 읽는다. 창을 닫고 종료하면 shell main의
// will-quit가 core에 stop frame을 보내 core가 정상 종료한다. 남은 프로세스는 띄운
// 트리의 정확한 pid로만 정리한다.
import { _electron as electron } from "playwright";

import {
  descendantPids,
  type DevToolsTarget,
  electronArgs,
  type ElectronLaunch,
  EXIT_TIMEOUT_MS,
  pickPageTarget,
  processAlive,
  readEvaluation,
  signalPids,
} from "./harness.ts";

/** 띄운 shell 하나. 창 DOM을 읽고 정확한 pid로 정리한다. */
export interface RunningShell {
  /** Electron 메인 프로세스 pid. */
  readonly pid: number;
  /** renderer DOM에서 표현식을 평가해 값을 돌려준다. */
  evaluate(expression: string): Promise<unknown>;
  /** 창을 닫고 종료한 뒤, 남은 자손을 정확한 pid로 정리한다. */
  close(): Promise<void>;
}

interface CdpMessage {
  id?: number;
  result?: { result?: { value?: unknown } };
  error?: { message?: string };
}

/** CDP 연결 하나. 요청 id로 응답을 맞춘다. */
class CdpSession {
  #socket: WebSocket;
  #next = 1;
  #pending = new Map<number, {
    resolve: (message: CdpMessage) => void;
    reject: (error: Error) => void;
  }>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      pending.resolve(message);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("cdp 연결이 닫혔다"));
      }
      this.#pending.clear();
    });
  }

  static async open(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("cdp 연결 실패")),
        { once: true },
      );
    });
    return new CdpSession(socket);
  }

  /** Runtime.evaluate 결과를 값으로 돌려준다. */
  async evaluate(expression: string): Promise<unknown> {
    const id = this.#next++;
    const message = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("cdp evaluate가 시간 안에 끝나지 않았다"));
      }, 10_000);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });
    return readEvaluation({ id, result: message.result, error: message.error });
  }

  close(): void {
    try {
      this.#socket.close();
    } catch { /* 이미 닫힘 */ }
  }
}

/** shell을 띄우고 renderer가 평가 가능해질 때까지 기다린다. */
export async function launchShell(
  launch: ElectronLaunch,
): Promise<RunningShell> {
  const app = await electron.launch({
    executablePath: launch.executable,
    args: electronArgs(launch),
    env: { ...Deno.env.toObject(), ...launch.env, LOPHN_HOME: launch.home },
    timeout: 60_000,
  });
  const pid = app.process().pid;
  if (pid === undefined) {
    await app.close();
    throw new Error("electron 프로세스 pid를 알지 못한다");
  }

  const page = await pageTarget(launch.port);
  const session = await CdpSession.open(page.webSocketDebuggerUrl!);

  return {
    pid,
    evaluate: (expression) => session.evaluate(expression),
    async close() {
      // 종료 전에 트리 전체를 기록해야 core 같은 자손 pid를 놓치지 않는다.
      const tree = await descendantPids(pid);
      session.close();
      try {
        await app.close();
      } catch { /* 이미 끝남 */ }
      await settle(tree);
    },
  };
}

/** 원격 디버깅 포트에서 shell 페이지 target이 뜰 때까지 기다린다. */
async function pageTarget(port: number): Promise<DevToolsTarget> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const targets = await response.json() as DevToolsTarget[];
        const page = pickPageTarget(targets);
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch { /* 아직 포트가 안 열림 */ }
    await delay(200);
  }
  throw new Error("shell renderer 디버깅 target이 뜨지 않았다");
}

/**
 * 프로세스가 스스로 끝날 때까지 기다린다. 한계가 지나도 살아 있으면 그 pid만
 * SIGKILL로 끝낸다. 기록에 없는 프로세스는 건드리지 않는다.
 */
async function settle(pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processAlive(pid))) return;
    await delay(200);
  }
  signalPids(pids.filter(processAlive), "SIGKILL");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
