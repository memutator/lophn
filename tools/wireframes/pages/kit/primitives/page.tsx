// Kit · primitives. @lophn/ui/primitives의 component를 고정 data로 그린다.
import { Folder, Search, Settings } from "lucide-react";
import {
  Button,
  CopyButton,
  FileIcon,
  Icon,
  IconButton,
  Kbd,
} from "@lophn/ui/primitives";
import {
  lophnSpaceIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { kit, Page, Row, Section } from "../kit.tsx";

const clipboard = { writeText: () => Promise.resolve() };

export function KitPrimitives() {
  const variants = ["primary", "secondary", "ghost", "danger"] as const;
  const sizes = ["sm", "md", "lg"] as const;
  return (
    <Page>
      <Section
        title="Button"
        note="variant 네 가지와 크기 세 가지. 크기는 Input·Select와 높이가 같다."
      >
        {variants.map((variant) => (
          <Row key={variant} label={variant}>
            {sizes.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size} Save
              </Button>
            ))}
            <Button variant={variant} icon={lophnSpaceIcons.add}>
              With icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </Row>
        ))}
      </Section>
      <Section
        title="IconButton"
        note="이름은 aria-label이다. 아이콘만 보인다."
      >
        {(["secondary", "ghost", "danger"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            {sizes.map((size) => (
              <IconButton
                key={size}
                icon={workspaceIcons.splitPane}
                label="Split pane"
                variant={variant}
                size={size}
              />
            ))}
            <IconButton
              icon={workspaceIcons.close}
              label="Close"
              variant={variant}
              disabled
            />
          </Row>
        ))}
      </Section>
      <Section
        title="Icon"
        note="Lucide 아이콘을 선 두께 token에 맞춰 그린다. pixels만 바꾼다."
      >
        <Row label="pixels">
          {[14, 16, 20, 24].map((pixels) => (
            <Icon key={pixels} icon={Search} pixels={pixels} />
          ))}
          <Icon icon={Settings} pixels={20} />
          <Icon icon={Folder} pixels={20} />
        </Row>
      </Section>
      <Section
        title="FileIcon"
        note="파일 이름의 확장자나 폴더 이름으로 종류를 고른다. 모르는 이름은 기본 파일·폴더다."
      >
        <Row label="files">
          {[
            "lophn.md",
            "report.md",
            "app.tsx",
            "data.json",
            "plan.yaml",
            "x.py",
            "chart.png",
            "unknown.zzz",
          ].map((
            name,
          ) => (
            <span key={name} className={kit.mono}>
              <FileIcon name={name} size={20} /> {name}
            </span>
          ))}
        </Row>
        <Row label="folders">
          {["docs", "src", "other"].map((name) => (
            <span key={name} className={kit.mono}>
              <FileIcon name={name} folder size={20} /> {name}
            </span>
          ))}
          <span className={kit.mono}>
            <FileIcon name="docs" folder open size={20} /> docs (open)
          </span>
        </Row>
      </Section>
      <Section title="Kbd">
        <Row label="keys">
          <Kbd keys={["Ctrl", "K"]} />
          <Kbd keys={["Ctrl", "Shift", "P"]} />
          <Kbd keys={["Esc"]} />
          <Kbd keys={["↑", "↓"]} />
        </Row>
      </Section>
      <Section title="CopyButton">
        <Row label="text">
          <span className={kit.mono}>lophn/weekly-report</span>
          <CopyButton
            text="lophn/weekly-report"
            label="Copy address"
            clipboard={clipboard}
          />
        </Row>
      </Section>
    </Page>
  );
}
