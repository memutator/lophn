// view에 묶을 연결 하나. 앱 통로의 연결과 부여 host, 그 연결의 partition을 함께 얻는다.
import type {
  AppBinding,
  AppConnector,
  ConnectTarget,
  Outcome,
} from "./app-connection.ts";
import type { FetchHost } from "./network-policy.ts";
import { appPartition } from "./session-policy.ts";

export interface Bound {
  target: ConnectTarget;
  binding: AppBinding;
  hosts: FetchHost[];
  partition: string;
}

export async function bindTarget(
  connector: Pick<AppConnector, "connect" | "hosts">,
  target: ConnectTarget,
  followRelease: boolean,
): Promise<Outcome<Bound>> {
  const binding = await connector.connect(target, followRelease);
  if (!binding.ok) return binding;
  const hosts = await connector.hosts(target.app, binding.value.release);
  if (!hosts.ok) return hosts;
  return {
    ok: true,
    value: {
      target: { ...target, release: binding.value.release },
      binding: binding.value,
      hosts: hosts.value,
      partition: appPartition(
        target.app,
        target.mode,
        binding.value.bundleHash,
      ),
    },
  };
}

function sameHosts(a: readonly FetchHost[], b: readonly FetchHost[]): boolean {
  const key = (host: FetchHost) => `${host.host} ${host.port}`;
  const left = new Set(a.map(key));
  return a.length === b.length && b.every((host) => left.has(key(host))) &&
    left.size === new Set(b.map(key)).size;
}

// release·프로세스·bundle·endpoint·host가 같으면 같은 연결이다. 만료만 다르면 새 서명만 쓴다.
export function sameConnection(current: Bound, next: Bound): boolean {
  return current.partition === next.partition &&
    current.binding.release === next.binding.release &&
    current.binding.bundleHash === next.binding.bundleHash &&
    current.binding.processNonce === next.binding.processNonce &&
    current.binding.endpoint === next.binding.endpoint &&
    sameHosts(current.hosts, next.hosts);
}
