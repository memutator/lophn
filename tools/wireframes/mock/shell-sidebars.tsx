// shell 틀 gallery page의 sidebar 자리 그림. 진짜 sidebar는 왼쪽·오른쪽 화면 task가 따로 그린다.
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

const head = {
  ...row,
  marginBlockStart: "var(--space-6)",
  color: "var(--color-text-muted)",
  fontSize: "var(--type-caption-size)",
} as const;

export function MockLeftSidebar() {
  return (
    <>
      <div style={row}>
        <Icon icon={shellIcons.newSession} pixels={16} />
        New session
      </div>
      <div style={row}>
        <Icon icon={shellIcons.jobs} pixels={16} />
        Jobs
      </div>
      <div style={head}>Places</div>
      <div style={{ ...row, color: "var(--color-text-primary)" }}>
        <Icon icon={shellIcons.folder} pixels={16} />
        phroner
      </div>
      <div style={{ ...row, paddingInlineStart: "var(--space-9)" }}>
        Pick up the body refactor
      </div>
      <div style={{ ...row, paddingInlineStart: "var(--space-9)" }}>
        Fix gaze interpolation
      </div>
    </>
  );
}

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
