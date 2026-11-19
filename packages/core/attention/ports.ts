// attention이 밖에서 받는 것. 기기 목록과 push 보내기는 remote와 push sender가 `bindPush`로 늦게 꽂는다.
import type { PushPrefs } from "../../protocol/attention/mod.ts";

export type { PushPrefs };

export type PushMessage = {
  to: string;
  title: string;
  body?: string;
  data: {
    host: string;
    kind: "session" | "app" | "inbox";
    session?: string;
    app?: string;
  };
  channelId: "needs-you" | "finished" | "apps";
  priority: "high" | "default";
  ttl: number;
};

// token이 있는 기기만 준다.
export type PushDevice = { id: string; token: string; prefs: PushPrefs };

export type PushPorts = {
  devices(): readonly PushDevice[];
  send(message: PushMessage): Promise<"sent" | "dropped">;
  host(): string;
};

// session 한 줄. 모르는 session(지워졌거나 없다)은 null이고 그 계기는 버린다.
export type SessionLookup = (session: string) => Promise<{
  title: string | null;
  agent: string | null;
  harness: string | null;
  opened_by_app: boolean;
} | null>;

// GUI view로 열린 coding session 한 줄. GUI 탭이 아니거나 lophn session이면 null이다.
export type CodingSessionInfo = {
  terminal_ref: string;
  harness: string;
  title: string | null;
};

export type CodingSessionLookup = (session: string) => CodingSessionInfo | null;

export type Attention = {
  bindPush(ports: PushPorts): void;
  // 기기 연결이 끊길 때 그 기기의 presence 보고를 지운다.
  forgetReporter(principal: string): void;
};
