import {
  appDirectSocketPaths,
  SOCKET_HOST,
} from "../../../protocol/apps/mod.ts";
import type { McpServerConfig } from "../../../protocol/lophn-agent/mod.ts";
import type { KindLaunchSpec } from "../../../protocol/supervision/mod.ts";
import { allowNetList, allowRunList } from "../extensions/mod.ts";
import { SHELL_ENV_NAMES } from "./shell/env.ts";

// agent runtime process의 Deno 권한 계산이다. `agentRuntimeLaunchSpec`(register.ts)이 이 결과를 그대로 launch spec에 싣는다.
export type RuntimePermissionInput = {
  dataRoot: string;
  apiPort: number;
  // supervisor가 앱 direct socket을 두는 폴더(`appSocketRoot`).
  socketRoot: string;
  mcpServers?: readonly McpServerConfig[];
  // 사람이 등록한 provider의 목적지(`host:port`).
  hosts?: readonly string[];
  skillRoots?: readonly string[];
  bundledSkillRoots?: readonly string[];
  // file tool과 shell이 닿는 place 폴더들이다. 절대 경로. 쓰기 폴더는 읽기 폴더 안에 있다.
  placeFolders: { read: readonly string[]; write: readonly string[] };
};

export type RuntimePermissions =
  & Pick<
    KindLaunchSpec,
    "allow_read" | "allow_write" | "allow_net" | "allow_run" | "allow_env"
  >
  & { net_any: true };

const BASE_ENV = [
  "LOPHN_HOME",
  "LOPHN_WORKER_KIND",
  "PATH",
  "HOME",
  "TEMP",
  "LC_ALL",
];

export function agentRuntimePermissions(
  input: RuntimePermissionInput,
): RuntimePermissions {
  const sockets = appDirectSocketPaths(input.socketRoot);
  return {
    allow_read: [
      input.dataRoot,
      ...(input.bundledSkillRoots ?? []),
      ...(input.skillRoots ?? []),
      ...sockets,
      ...input.placeFolders.read,
    ],
    // derived만 쓴다. ledger·blob·원본은 쓰지 않는다. place 폴더는 file.write와 file.edit의 몫이다.
    allow_write: [
      `${input.dataRoot}/derived/lophn-agent`,
      ...sockets,
      ...input.placeFolders.write,
    ],
    // web.fetch가 임의 host로 나가므로 net_any가 켜진다. allow_net 목록은 그 밖의 도달 대상을 적어 둔다.
    allow_net: [
      `127.0.0.1:${input.apiPort}`,
      SOCKET_HOST,
      ...sockets.map((path) => `unix:${path}`),
      ...(input.hosts ?? []),
      ...allowNetList(input.mcpServers ?? []),
    ],
    net_any: true,
    // MCP stdio 실행 파일과 shell.run의 /bin/sh.
    allow_run: [...allowRunList(input.mcpServers ?? []), "/bin/sh"],
    allow_env: [...new Set([...BASE_ENV, ...SHELL_ENV_NAMES])],
  };
}
