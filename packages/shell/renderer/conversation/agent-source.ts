// 호스트가 쓰는 옛 이름. 호스트가 `AgentTabSourceFactory`로 갈아탄 뒤 cleanup이 이 file을 지운다.
import type { AgentTabSourceFactory } from "./agent-tab-source.ts";

export type AgentViewSourceFactory = AgentTabSourceFactory;
