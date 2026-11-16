// The phone's app stores, one per computer, and what goes when a computer is no longer paired. Without React, so the
// data provider (which outlives every screen, also the last computer's removal) can forget computers.
import { appDir, paths } from "../apps/local/folder.ts";
import { nativeDeps } from "../apps/local/native.ts";
import { pruneApp } from "../apps/local/prune.ts";
import { createLocalApps, type LocalApps } from "../apps/local/store.ts";
import { loadComputers } from "../pairing/store.ts";

// One store per computer for the app's life: the sync work of a computer goes on while its screens come and go.
const stores = new Map<string, LocalApps>();
export const holders = new Map<LocalApps, number>();

export function storeFor(computer: string): LocalApps {
  let store = stores.get(computer);
  if (store === undefined) {
    store = createLocalApps({
      ...nativeDeps,
      computer,
      node: async () => {
        const saved = (await loadComputers()).find((one) => one.key === computer);
        if (saved === undefined) throw new Error("the computer is not paired");
        return saved.device;
      },
    });
    stores.set(computer, store);
  }
  return store;
}

// The app folders of computers no longer paired go, but for what the computer does not have (prune.ts): a sync app's
// unsent changes and a standalone app's data stay, and come back if the phone pairs with that computer again.
let forgetting: Promise<void> = Promise.resolve();
export function forgetLocalComputers(paired: readonly string[]) {
  const { files } = nativeDeps;
  forgetting = forgetting
    .then(async () => {
      for (const computer of files.list("")) {
        if (paired.includes(computer)) continue;
        stores.get(computer)?.connect(null);
        stores.delete(computer);
        for (const app of files.list(computer)) {
          // A folder without installed.json is an install that stopped.
          if (!files.exists(paths(computer, app).installed)) files.remove(appDir(computer, app));
          else await pruneApp(nativeDeps, computer, app);
        }
        if (files.list(computer).length === 0) files.remove(computer);
      }
    })
    // One that fails is tried again at the next change of the paired list.
    .catch(() => {});
}
