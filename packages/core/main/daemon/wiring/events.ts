import { createBus, createGatewayFrames } from "../../../events/mod.ts";
import type { WiringFactory } from "./context.ts";

// Bus 하나를 만들어 모두에게 준다. Gateway 연결은 서버가 이 Bus에 붙이고,
// Bus 밖 frame(터미널 요청 등)은 gateway slot으로 보낸다.
export const eventsWiring: WiringFactory = () => ({
  name: "events",
  prepare(ctx) {
    ctx.provide("bus", createBus());
    ctx.provide("gateway", createGatewayFrames());
    // 사람 token의 operation 목록. Gateway는 operation이 아니라 actor로 열려 비었다.
    ctx.provide("eventNames", []);
  },
});
