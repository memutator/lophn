import { devicesUnpair } from "../../../protocol/remote/routes.ts";
import { commandCall } from "../../../shell/renderer/command-call.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";

// Asks the computer to drop this phone from its device list. Settles on the answer or when the computer closes the
// connection (it does so right after, as for any removed device); the phone forgets the computer either way.
export async function unpair(core: CoreSource): Promise<void> {
  await core.call(
    commandCall(devicesUnpair, {
      input: {},
      compare: {},
      key: crypto.randomUUID(),
    }),
  );
}
