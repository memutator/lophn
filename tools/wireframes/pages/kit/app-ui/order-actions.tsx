// 앱 화면 예: 앱 blueprint의 tool 선언으로 버튼을 만든다.
import { type AppBridge, ToolButton, type ToolSpec } from "@lophn/app-ui";

// 앱 blueprint의 tools 중 이 화면이 쓰는 것.
export const TOOLS = {
  sync: { name: "sync-orders", title: "Sync orders" },
  archive: { name: "archive-shipped", title: "Archive shipped orders" },
} satisfies Record<string, ToolSpec>;

export function OrderActions(
  { app, selected }: { app?: AppBridge; selected: () => string[] },
) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-4)",
      }}
    >
      <ToolButton tool={TOOLS.sync} app={app} />
      <ToolButton
        tool={TOOLS.archive}
        input={() => ({ orders: selected() })}
        app={app}
      />
    </div>
  );
}
