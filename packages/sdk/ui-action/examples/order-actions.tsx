// 앱 화면 예: 앱 blueprint의 command 선언으로 버튼을 만든다. 확인 표시는 effect가 아니라 confirm 선언을 따른다.
import type { CommandDeclaration } from "@lophn/blueprint";
import {
  type AppBridge,
  CommandButton,
  type CommandSpec,
  type Timer,
} from "@lophn/ui-action";
import styles from "./order-actions.module.css";

type Declared = Pick<CommandDeclaration, "effect"> & CommandSpec;

// 앱 blueprint의 commands 중 이 화면이 쓰는 것. 바깥으로 나가도 확인 없이 도는 동기화가 있고,
// 바깥으로 나가지 않아도 사람 확인을 받는 보관이 있다.
export const COMMANDS = {
  sync: {
    key: "sync-orders",
    label: "Sync orders",
    effect: "external",
    confirm: false,
  },
  archive: {
    key: "archive-shipped",
    label: "Archive shipped orders",
    effect: "write",
    confirm: true,
  },
} satisfies Record<string, Declared>;

export function OrderActions(
  { app, selected, timer }: {
    app?: AppBridge;
    selected: () => string[];
    timer?: Timer;
  },
) {
  return (
    <div className={styles.actions}>
      <CommandButton command={COMMANDS.sync} app={app} timer={timer} />
      <CommandButton
        command={COMMANDS.archive}
        input={() => ({ orders: selected() })}
        app={app}
        timer={timer}
      />
    </div>
  );
}
