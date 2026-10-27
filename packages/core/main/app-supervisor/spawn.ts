// 운영 앱 자식의 실제 OS spawn. package는 기동 입력만 만들고 여기가 띄운다.

import {
  type AppLaunch,
  appCommand,
} from "../../apps/runtime/processes/mod.ts";
import {
  type Spawned,
  spawnProcess,
} from "../../supervision/responsiveness/process.ts";

export async function spawnApp(launch: AppLaunch): Promise<Spawned> {
  const command = appCommand(launch);
  const child = spawnProcess({
    command: command.command,
    args: command.args,
    env: command.env,
    cwd: command.cwd,
  });
  await child.stdin.write(new TextEncoder().encode(`${launch.startLine}\n`));
  await child.stdin.close();
  return child;
}
