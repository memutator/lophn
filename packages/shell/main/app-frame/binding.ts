// view에 묶을 연결 하나. 앱 통로의 연결과 부여 host, 그 연결의 partition을 함께 얻는다.
import type { AppConnector, ConnectTarget, Outcome } from "./app-connection.ts";
import { appPartition } from "./session-policy.ts";
import type { Bound } from "./view-model.ts";

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
