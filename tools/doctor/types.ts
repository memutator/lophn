// doctor의 check 하나가 받는 것과 내놓는 것. fs·net·spawn을 주입해 check가 global을 직접 만지지 않게 한다.
// 그래서 check의 입력(fs, network, env)을 test에서 갈아 끼울 수 있다.

import type { ControlDial } from "../../packages/protocol/client/mod.ts";

export type Status = "pass" | "warn" | "fail";

export type Fix = {
  // 저장소 root에서 그대로 칠 수 있는 한 줄. fix가 있어도 apply가 없으면 사람이 고른다.
  command: string;
  // --fix가 직접 고치는, 안전하고 되돌릴 수 있는 변경만 둔다(sudo·network이 필요한 것은 없다).
  apply?: () => Promise<void>;
};

export type Outcome = {
  status: Status;
  detail: string;
  fix?: Fix;
};

export type SpawnResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  // spawn 자체가 실패했거나 시간이 지났을 때. code가 null인 이유다.
  error?: string;
};

export type FileStat = {
  mode: number;
  uid: number;
  isDir: boolean;
};

export type Fs = {
  exists(path: string): Promise<boolean>;
  // 없으면 null.
  readText(path: string): Promise<string | null>;
  stat(path: string): Promise<FileStat | null>;
  list(path: string): Promise<string[] | null>;
  copyText(src: string, dest: string, mode: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, mode: number): Promise<void>;
};

export type HttpResult =
  | { kind: "response"; status: number; body: string; latencyMs: number }
  | { kind: "error"; message: string };

export type Net = {
  // 127.0.0.1에 listen해 보고 바로 닫는다. 성공하면 free.
  probe(port: number): Promise<"free" | "busy">;
  freePort(): Promise<number>;
  tcp(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  httpGet(
    url: string,
    opts?: { token?: string; timeoutMs?: number },
  ): Promise<HttpResult>;
};

export type Spawn = (
  command: string,
  args: string[],
  opts?: { env?: Record<string, string | undefined>; timeoutMs?: number },
) => Promise<SpawnResult>;

export type Ctx = {
  root: string;
  env: Record<string, string | undefined>;
  fs: Fs;
  net: Net;
  spawn: Spawn;
  // node_modules/electron이 내놓는 binary. resolve가 안 되면 null.
  electronPath: string | null;
  // data root의 core control socket에 한 줄 보낸다(진단만 한다. core를 띄우지 않는다).
  control(dataRoot: string): ControlDial;
};

export type Check = {
  id: string;
  title: string;
  run(ctx: Ctx): Promise<Outcome>;
};
