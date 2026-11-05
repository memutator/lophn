// 실제 앱에서 card 머리는 본문이 올린 center·actions를 그리고 맨 오른쪽 ⋯ 메뉴에 본문이 올린 menu 항목을 맨 위 묶음으로 둔다.
// 그 한 줄만 흉내 낸다. 채팅 화면(TerminalGui)과 터미널 탭(TerminalTab)이 같은 머리를 쓴다.
import { Menu } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { type ReactNode, useState } from "react";

import { editorIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import {
  CardHeadContext,
  type CardHeadSpec,
} from "../../../../../packages/shell/renderer/shell/card-head.tsx";

export function HeadCard({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<CardHeadSpec | null>(null);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface-base)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
        }}
      >
        {head?.center}
        {head?.actions}
        <Menu
          items={head?.menu?.items ?? []}
          onSelect={(id) => head?.menu?.onSelect(id)}
          trigger={
            <IconButton
              icon={editorIcons.menu}
              label="More"
              size="sm"
              data-card-more=""
            />
          }
        />
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        <CardHeadContext.Provider value={setHead}>
          {children}
        </CardHeadContext.Provider>
      </div>
    </div>
  );
}
