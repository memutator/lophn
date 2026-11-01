// 앱 화면 예: 앱 선언의 operation 선언으로 버튼을 만든다.
import {
  type AppBridge,
  OperationButton,
  type OperationSpec,
} from "@lophn/app-ui";

// 앱 선언의 operations 중 이 화면이 쓰는 것.
export const OPERATIONS = {
  sync: { name: "sync-orders", title: "Sync orders" },
  archive: { name: "archive-shipped", title: "Archive shipped orders" },
} satisfies Record<string, OperationSpec>;

export function OrderActions({
  app,
  selected,
}: {
  app?: AppBridge;
  selected: () => string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-4)",
      }}
    >
      <OperationButton operation={OPERATIONS.sync} app={app} />
      <OperationButton
        operation={OPERATIONS.archive}
        input={() => ({ orders: selected() })}
        app={app}
      />
    </div>
  );
}
