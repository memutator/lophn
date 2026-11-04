// extension 입구. registry가 따로 빌드한 CJS(`dist/index.cjs`)를 require해 activate를 부른다.
import type { ExtensionContext } from "../../../../../protocol/extensions/manifest.ts";
import { createHarnessHost } from "./host.ts";

let host: ReturnType<typeof createHarnessHost> | undefined;

export function activate(ctx: ExtensionContext): void {
  host = createHarnessHost(ctx);
  host.start();
}

export async function deactivate(): Promise<void> {
  await host?.stop();
  host = undefined;
}
