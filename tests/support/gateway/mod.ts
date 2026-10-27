// test가 shell main 역할로 Gateway에 붙는 연결이다. 받은 frame을 순서대로 쌓고 신호를 읽으며 기다린다.
import {
  type EventCondition,
  GATEWAY_PATH,
  GATEWAY_SUBPROTOCOL,
  type GatewayServerFrame,
  gatewayServerFrameSchema,
} from "../../../packages/protocol/events/mod.ts";
import type { Core } from "../core/mod.ts";

const WAIT_MS = 30_000;

type FrameOf<T extends GatewayServerFrame["type"]> = Extract<
  GatewayServerFrame,
  { type: T }
>;

export type Gateway = {
  /** 받은 순서 전부 */
  frames(): readonly GatewayServerFrame[];
  /** 아직 안 가져간 frame 중 처음 맞는 것. 없으면 올 때까지(제한 시간 30초) 기다린다. */
  next<T extends GatewayServerFrame["type"]>(
    type: T,
    match?: (frame: FrameOf<T>) => boolean,
    timeoutMs?: number,
  ): Promise<FrameOf<T>>;
  /** 조건을 바꾸고 `ready`를 기다린다. */
  watch(conditions: EventCondition[]): Promise<void>;
  /** 소켓을 닫고 onclose까지 기다린다. */
  close(): Promise<void>;
};

export async function connectGateway(
  core: Core,
  options: { conditions?: EventCondition[] } = {},
): Promise<Gateway> {
  const url = core.baseUrl.replace(/^http/, "ws") + GATEWAY_PATH;
  const socket = new WebSocket(url, {
    protocols: [GATEWAY_SUBPROTOCOL],
    headers: { authorization: "Bearer " + core.token },
  } as unknown as string[]);
  const frames: GatewayServerFrame[] = [];
  const taken = new Set<GatewayServerFrame>();
  let failure: Error | undefined;
  let wake: (() => void)[] = [];
  const notify = () => {
    const waiting = wake;
    wake = [];
    for (const resolve of waiting) resolve();
  };
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => {
      failure ??= new Error("Gateway 연결이 닫혔다");
      notify();
      resolve();
    });
  });
  socket.addEventListener("error", () => {
    failure ??= new Error("Gateway 연결 오류");
    notify();
  });
  socket.addEventListener("message", (event) => {
    const parsed = gatewayServerFrameSchema.safeParse(
      JSON.parse(String(event.data)),
    );
    if (parsed.success) frames.push(parsed.data);
    else failure = new Error("Gateway frame이 schema와 다르다: " + event.data);
    notify();
  });

  async function next<T extends GatewayServerFrame["type"]>(
    type: T,
    match: (frame: FrameOf<T>) => boolean = () => true,
    timeoutMs = WAIT_MS,
  ): Promise<FrameOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = frames.find(
        (frame) =>
          !taken.has(frame) &&
          frame.type === type &&
          match(frame as FrameOf<T>),
      );
      if (found !== undefined) {
        taken.add(found);
        return found as FrameOf<T>;
      }
      if (failure !== undefined) throw failure;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(`${timeoutMs}ms 안에 ${type} frame이 오지 않았다`);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        new Promise<void>((resolve) => wake.push(resolve)),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, left))),
      ]);
      clearTimeout(timer);
    }
  }

  async function watch(conditions: EventCondition[]): Promise<void> {
    socket.send(JSON.stringify({ type: "watch", conditions }));
    await next("ready");
  }

  const gateway: Gateway = {
    frames: () => frames,
    next,
    watch,
    async close() {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
      await closed;
    },
  };
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Gateway 연결이 열리지 않았다")),
        { once: true },
      );
    });
    await watch(options.conditions ?? []);
  } catch (error) {
    await gateway.close();
    throw error;
  }
  return gateway;
}
