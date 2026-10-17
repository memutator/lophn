// 앱 화면 예: 앱 blueprint의 app-api 선언으로 버튼을 만든다.
import { AppApiButton, type AppApiSpec, type AppBridge } from "@lophn/app-ui";
import styles from "./order-actions.module.css";

// 앱 blueprint의 app_api 중 이 화면이 쓰는 것.
export const APP_APIS = {
  sync: { key: "sync-orders", label: "Sync orders" },
  archive: { key: "archive-shipped", label: "Archive shipped orders" },
} satisfies Record<string, AppApiSpec>;

export function OrderActions(
  { app, selected }: { app?: AppBridge; selected: () => string[] },
) {
  return (
    <div className={styles.actions}>
      <AppApiButton api={APP_APIS.sync} app={app} />
      <AppApiButton
        api={APP_APIS.archive}
        input={() => ({ orders: selected() })}
        app={app}
      />
    </div>
  );
}
