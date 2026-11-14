// 앱 화면 예: 같은 줄의 조작을 sm(28px)·md(32px)·lg(36px) 한 크기로 맞춘다. 마지막 줄은 phone 화면의
// touch density로 그린 md다.
import type { CSSProperties } from "react";
import { Search } from "lucide-react";
import { appearancePresets } from "@lophn/ui";
import { Checkbox, Field, Input, Select, Switch } from "@lophn/ui/input";
import { Button, IconButton, Kbd } from "@lophn/ui/primitives";
import type { ControlSize } from "@lophn/ui/shared";

const ROWS: readonly {
  id: string;
  size: ControlSize;
  style?: CSSProperties;
}[] = [
  { id: "sm", size: "sm" },
  { id: "md", size: "md" },
  { id: "lg", size: "lg" },
  {
    id: "touch",
    size: "md",
    style: tokenVars(appearancePresets.density.touch),
  },
];

// appearanceCss는 html:root 전체를 덮는다. 한 줄만 touch로 그리려고 같은 token 덮어쓰기를 그 줄의 CSS 변수로 둔다.
function tokenVars(override: object, prefix = "-"): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(override)) {
    const name = `${prefix}-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (typeof value === "object") Object.assign(vars, tokenVars(value, name));
    else vars[name] = String(value);
  }
  return vars as CSSProperties;
}

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  save: "Save",
  search: "Search",
  name: "Name",
  status: "Status",
  open: "Open",
  closed: "Closed",
  archived: "Include archived",
  sync: "Sync automatically",
};

export function ControlSizes() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
      }}
    >
      {ROWS.map(({ id, size, style }) => (
        <div
          key={id}
          data-row={id}
          style={{
            ...style,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: "var(--space-5)",
          }}
        >
          <Button variant="primary" size={size}>
            {TEXT.save}
          </Button>
          <IconButton icon={Search} label={TEXT.search} size={size} />
          <Field label={TEXT.name}>
            <Input size={size} />
          </Field>
          <Field label={TEXT.status}>
            <Select
              size={size}
              defaultValue="open"
              options={[
                { value: "open", label: TEXT.open },
                { value: "closed", label: TEXT.closed },
              ]}
            />
          </Field>
          <Checkbox size={size} label={TEXT.archived} />
          <Switch size={size} label={TEXT.sync} />
          <Kbd keys={["Ctrl", "K"]} />
        </div>
      ))}
    </div>
  );
}
