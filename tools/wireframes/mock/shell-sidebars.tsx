// shell 틀 gallery page의 sidebar 자리 그림. 오른쪽 panel 본문 자리 그림이다.
import { Icon } from "@lophn/ui/primitives";
import { shellIcons } from "../../../packages/shell/renderer/icons/mod.ts";
import {
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../../packages/shell/renderer/shell/panel-rows.tsx";
import { RightSidebar } from "../../../packages/shell/renderer/shell/right-sidebar.tsx";

const row = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  minHeight: "var(--control-sm-height)",
  padding: "var(--space-1) var(--space-3)",
  color: "var(--color-text-secondary)",
  fontSize: "var(--type-small-size)",
} as const;

const MOCK_ROWS = [
  { title: "body", meta: "9 files" },
  { title: "gaze", meta: "4 files" },
  { title: "README.md", meta: "2 days ago" },
  { title: "package.json", meta: "last week" },
] as const;

export function MockRightSidebar({ title }: { title: string }) {
  return (
    <RightSidebar title={title}>
      <PanelRows label={title}>
        {MOCK_ROWS.map((item) => (
          <PanelRow
            key={item.title}
            leading={<TileIcon icon={shellIcons.folder} />}
            title={item.title}
            meta={item.meta}
          />
        ))}
      </PanelRows>
    </RightSidebar>
  );
}
