// 앱 화면 예: 같은 줄의 조작을 sm(28px)·md(32px)·lg(36px) 한 크기로 맞춘다.
import { Search } from "lucide-react";
import { Checkbox, Field, Input, Select, Switch } from "@lophn/ui/input";
import { Button, IconButton, Kbd } from "@lophn/ui/primitives";
import type { ControlSize } from "@lophn/ui/shared";

const SIZES: readonly ControlSize[] = ["sm", "md", "lg"];

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
      {SIZES.map((size) => (
        <div
          key={size}
          data-row={size}
          style={{
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
