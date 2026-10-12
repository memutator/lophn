// 운영 앱 자식의 실제 OS spawn. package는 기동 입력만 만들고 여기가 띄운다.
import {
  type Spawned,
  spawnProcess,
} from "../../supervision/responsiveness/process.ts";
import {
  appArgv,
  appEnv,
  type AppLaunch,
  flagsAccepted,
} from "../../apps/runtime/processes/mod.ts";

export async function spawnApp(launch: AppLaunch): Promise<Spawned> {
  if (!flagsAccepted(launch.flags)) {
    throw new Error("app flags include a forbidden flag");
  }
  const child = spawnProcess({
    command: launch.deno,
    args: appArgv(launch),
    env: appEnv(launch.environment),
  });
  await child.stdin.write(new TextEncoder().encode(`${launch.startLine}\n`));
  await child.stdin.close();
  return child;
}
