// 디자인 시스템 · Tokens 네 page. 값은 @lophn/design의 tokens에서 그대로 읽는다.
import { tokens } from "@lophn/design";
import { Icon, iconPixels, STATUS_ICONS } from "@lophn/design/components";
import {
  appSpaceIcons,
  connectionFailedIcon,
  connectionStaleIcon,
  conversationIcons,
  editorIcons,
  launcherEmptyIcon,
  launcherIcons,
  lophnEntryIcon,
  lophnSpaceIcons,
  paletteIcons,
  retryIcon,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import type { IconProps } from "@lophn/design/components";

import { kit, Page, Row, Section } from "./kit.tsx";

// generate.ts의 flatten과 같은 규칙으로 css 변수 이름을 만든다(camelCase는 -로 잇는다).
function segment(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

interface Themed {
  readonly light: string;
  readonly dark: string;
}

function isThemed(value: unknown): value is Themed {
  return typeof value === "object" && value !== null && "light" in value &&
    "dark" in value && typeof (value as Themed).light === "string";
}

function themed(
  source: unknown,
  path: string[] = [],
): { name: string; value: Themed }[] {
  if (isThemed(source)) {
    return [{ name: `--${path.map(segment).join("-")}`, value: source }];
  }
  if (typeof source !== "object" || source === null) return [];
  return Object.entries(source).flatMap(([key, child]) =>
    themed(child, [...path, key])
  );
}

const COLOR_GROUPS: readonly {
  title: string;
  note?: string;
  source: unknown;
  path: string[];
}[] = [
  {
    title: "Surface",
    source: tokens.color.surface,
    path: ["color", "surface"],
  },
  { title: "Border", source: tokens.color.border, path: ["color", "border"] },
  { title: "Text", source: tokens.color.text, path: ["color", "text"] },
  { title: "Ink", source: tokens.color.ink, path: ["color", "ink"] },
  {
    title: "Link, focus, selection",
    source: {
      link: tokens.color.link,
      focus: tokens.color.focus,
      selection: tokens.color.selection,
    },
    path: ["color"],
  },
  {
    title: "Status",
    note:
      "marker는 점·막대, text는 글자 색이다. 색만으로 뜻을 전하지 않고 아이콘과 글자를 함께 쓴다.",
    source: tokens.status,
    path: ["status"],
  },
  {
    title: "Chart",
    note:
      "series 여덟 색과 기타. light의 일부 색은 라벨이나 표를 함께 보여야 한다(lightNeedsLabelOrTable).",
    source: tokens.chart,
    path: ["chart"],
  },
  { title: "Diff", source: tokens.diff, path: ["diff"] },
  { title: "Floating", source: tokens.floating, path: ["floating"] },
];

function Swatch({ color }: { color: string }) {
  return (
    <span className={kit.swatch}>
      <span className={kit.chipColor} style={{ background: color }} />
      <span className={kit.hex}>{color}</span>
    </span>
  );
}

/** Tokens · colors: 모든 색 token을 light와 dark 값 나란히. */
export function TokensColors() {
  return (
    <Page>
      <p className={kit.note}>
        견본은 token의 light와 dark 값을 그대로 칠한 것이라 위쪽 테마 선택과
        상관없이 두 값이 같이 보인다. 글자와 테두리는 지금 테마를 따른다.
      </p>
      {COLOR_GROUPS.map((group) => {
        const rows = themed(group.source, group.path);
        return (
          <Section key={group.title} title={group.title} note={group.note}>
            <div>
              <div className={kit.swatchRow}>
                <span className={kit.swatchHead}>token</span>
                <span className={kit.swatchHead}>light</span>
                <span className={kit.swatchHead}>dark</span>
              </div>
              {rows.map((row) => (
                <div key={row.name} className={kit.swatchRow}>
                  <span className={kit.hex}>{row.name}</span>
                  <Swatch color={row.value.light} />
                  <Swatch color={row.value.dark} />
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </Page>
  );
}

const SAMPLE_EN = "The quick brown fox jumps over the lazy dog 0123456789";
const SAMPLE_KO = "다람쥐 헌 쳇바퀴에 타고파. 문서와 앱을 한 곳에서 다룹니다.";

const TYPE_STEPS = [
  "display",
  "title",
  "titleSmall",
  "reading",
  "body",
  "small",
  "caption",
] as const;

function kebab(key: string): string {
  return segment(key);
}

/** Tokens · type. */
export function TokensType() {
  return (
    <Page>
      <Section
        title="Scale"
        note="크기와 줄 높이 한 쌍이 한 단이다. 영어와 한국어를 같은 단으로 보인다."
      >
        <div>
          {TYPE_STEPS.map((step) => {
            const name = kebab(step);
            return (
              <div key={step} className={kit.typeSample}>
                <span className={kit.typeMeta}>
                  --type-{name}-size {tokens.type[step].size}{" "}
                  / --type-{name}-line {tokens.type[step].line}
                </span>
                <p
                  className={kit.typeText}
                  style={{
                    fontSize: `var(--type-${name}-size)`,
                    lineHeight: `var(--type-${name}-line)`,
                  }}
                >
                  {SAMPLE_EN}
                </p>
                <p
                  className={kit.typeText}
                  style={{
                    fontSize: `var(--type-${name}-size)`,
                    lineHeight: `var(--type-${name}-line)`,
                  }}
                >
                  {SAMPLE_KO}
                </p>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="Weight">
        {Object.entries(tokens.font.weight).map(([name, weight]) => (
          <Row key={name} label={`--font-weight-${name} ${weight}`}>
            <span style={{ fontWeight: `var(--font-weight-${name})` }}>
              {SAMPLE_EN} · 굵기 견본
            </span>
          </Row>
        ))}
      </Section>
      <Section title="Tracking">
        {Object.entries(tokens.type.tracking).map(([name, value]) => (
          <Row key={name} label={`--type-tracking-${name} ${value}`}>
            <span
              style={{
                fontSize: "var(--type-title-size)",
                letterSpacing: `var(--type-tracking-${name})`,
              }}
            >
              Release notes 릴리스 노트
            </span>
          </Row>
        ))}
      </Section>
      <Section title="Font families">
        <Row label="--font-sans">
          <span>
            {tokens.font.sans} — {SAMPLE_EN} {SAMPLE_KO}
          </span>
        </Row>
        <Row label="--font-mono">
          <span className={kit.mono}>
            {tokens.font.mono}{" "}
            — deno task check · eval.findings.find(&#123; about: "C-049" &#125;)
          </span>
        </Row>
        <Row label="--font-numeric tabular-nums">
          <span style={{ fontVariantNumeric: "var(--font-numeric)" }}>
            1,234.50 · 9,876.00 · 0,111.11
          </span>
        </Row>
      </Section>
    </Page>
  );
}

function px(value: string): number {
  return Number.parseFloat(value);
}

const WIDTHS: readonly { name: string; value: string; group: string }[] = [
  {
    group: "Page frames",
    name: "--page-reading-narrow",
    value: tokens.page.reading.narrow,
  },
  {
    group: "Page frames",
    name: "--page-reading-default",
    value: tokens.page.reading.default,
  },
  {
    group: "Page frames",
    name: "--page-reading-wide",
    value: tokens.page.reading.wide,
  },
  { group: "Page frames", name: "--page-toc", value: tokens.page.toc },
  { group: "Page frames", name: "--page-list", value: tokens.page.list },
  { group: "Page frames", name: "--page-form", value: tokens.page.form },
  {
    group: "Page frames",
    name: "--page-overview",
    value: tokens.page.overview,
  },
  {
    group: "Page frames",
    name: "--page-launcher",
    value: tokens.page.launcher,
  },
  {
    group: "Page frames",
    name: "--page-dashboard-max",
    value: tokens.page.dashboard.max,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-sidebar-collapsed",
    value: tokens.layout.sidebar.collapsed,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-sidebar-min",
    value: tokens.layout.sidebar.min,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-sidebar-max",
    value: tokens.layout.sidebar.max,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-container-card",
    value: tokens.layout.container.card,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-container-panel",
    value: tokens.layout.container.panel,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-pane-padding-narrow",
    value: tokens.layout.panePadding.narrow,
  },
  {
    group: "Sidebar and panes",
    name: "--layout-pane-padding-wide",
    value: tokens.layout.panePadding.wide,
  },
  {
    group: "Floating surfaces",
    name: "--dialog-width-default",
    value: tokens.dialog.width.default,
  },
  {
    group: "Floating surfaces",
    name: "--dialog-width-wide",
    value: tokens.dialog.width.wide,
  },
  {
    group: "Floating surfaces",
    name: "--palette-width",
    value: tokens.palette.width,
  },
  {
    group: "Floating surfaces",
    name: "--toast-width",
    value: tokens.toast.width,
  },
  {
    group: "Floating surfaces",
    name: "--chip-width",
    value: tokens.chip.width,
  },
  {
    group: "Breakpoints",
    name: "--breakpoint-sm",
    value: `${tokens.breakpoint.sm}px`,
  },
  {
    group: "Breakpoints",
    name: "--breakpoint-md",
    value: `${tokens.breakpoint.md}px`,
  },
  {
    group: "Breakpoints",
    name: "--breakpoint-lg",
    value: `${tokens.breakpoint.lg}px`,
  },
];

const WIDTH_GROUPS = [...new Set(WIDTHS.map((width) => width.group))];
const WIDEST = 1440;

/** Tokens · space & layout. */
export function TokensSpace() {
  return (
    <Page>
      <Section
        title="Space"
        note="간격은 이 열세 단만 쓴다. 막대 길이가 값이다."
      >
        {tokens.space.map((value, index) => (
          <Row key={index} label={`--space-${index} ${value}`}>
            <span
              className={kit.bar}
              style={{ width: `var(--space-${index})`, minWidth: "1px" }}
            />
          </Row>
        ))}
      </Section>
      <Section title="Radius">
        <div className={kit.row}>
          {Object.entries(tokens.radius).map(([name, value]) => (
            <div key={name} className={kit.column}>
              <span
                className={kit.box}
                style={{ borderRadius: `var(--radius-${name})` }}
              />
              <span className={kit.hex}>--radius-{name} {value}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Border and focus ring">
        <Row label={`--border-width ${tokens.border.width}`}>
          <span
            className={kit.box}
            style={{ borderWidth: "var(--border-width)" }}
          />
        </Row>
        <Row
          label={`--border-focus-width ${tokens.border.focus.width} · offset ${tokens.border.focus.offset}`}
        >
          <span
            className={kit.box}
            style={{
              outline: "var(--border-focus-width) solid var(--color-focus)",
              outlineOffset: "var(--border-focus-offset)",
            }}
          />
        </Row>
      </Section>
      <Section
        title="Elevation"
        note="그림자는 떠 있는 표면(popover, dialog)만 쓴다. 일반 카드에는 없다."
      >
        <div className={`${kit.panel} ${kit.row}`}>
          <div className={kit.column}>
            <span
              className={kit.elevated}
              style={{ boxShadow: "var(--shadow-popover)" }}
            >
              popover
            </span>
            <span className={kit.hex}>--shadow-popover</span>
          </div>
          <div className={kit.column}>
            <span
              className={kit.elevated}
              style={{ boxShadow: "var(--shadow-dialog)" }}
            >
              dialog
            </span>
            <span className={kit.hex}>--shadow-dialog</span>
          </div>
        </div>
      </Section>
      <Section title="z-index" note="큰 값이 위에 놓인다.">
        {Object.entries(tokens.z)
          .sort((a, b) => a[1] - b[1])
          .map(([name, value]) => (
            <Row key={name} label={`--z-${name}`}>
              <span className={kit.mono}>{value}</span>
              <span
                className={`${kit.bar} ${kit.barWide}`}
                style={{ width: `${Math.max(value / 400, 0.01) * 100}%` }}
              />
            </Row>
          ))}
      </Section>
      <Section title="Control and icon sizes">
        {(["sm", "md", "lg"] as const).map((size) => (
          <Row
            key={size}
            label={`--control-${size}-height ${tokens.control[size].height}`}
          >
            <span
              className={kit.box}
              style={{
                width: `var(--control-${size}-height)`,
                height: `var(--control-${size}-height)`,
              }}
            />
            <span className={kit.hex}>
              pad-x {tokens.control[size].padX} · icon{" "}
              {tokens.control[size].icon}
            </span>
          </Row>
        ))}
        {Object.entries(tokens.icon.size).map(([name, value]) => (
          <Row key={name} label={`--icon-size-${name} ${value}`}>
            <span
              className={kit.box}
              style={{
                width: `var(--icon-size-${name})`,
                height: `var(--icon-size-${name})`,
              }}
            />
          </Row>
        ))}
      </Section>
      <Section
        title="Widths"
        note={`막대 길이는 ${WIDEST}px(--page-dashboard-max)를 100%로 한 비율이다. 가장 긴 막대가 폭의 끝이다.`}
      >
        {WIDTH_GROUPS.map((group) => (
          <div key={group}>
            <p className={kit.sub}>{group}</p>
            {WIDTHS.filter((width) => width.group === group).map((width) => (
              <Row key={width.name} label={`${width.name} ${width.value}`}>
                <span
                  className={`${kit.bar} ${kit.barWide}`}
                  style={{ width: `${(px(width.value) / WIDEST) * 100}%` }}
                />
              </Row>
            ))}
          </div>
        ))}
      </Section>
      <Section title="Motion">
        {Object.entries(tokens.motion.duration).map(([name, value]) => (
          <Row key={name} label={`--motion-duration-${name}`}>
            <span className={kit.mono}>{value}</span>
          </Row>
        ))}
        <Row label="--motion-ease">
          <span className={kit.mono}>{tokens.motion.ease}</span>
        </Row>
      </Section>
    </Page>
  );
}

type IconSet = { readonly [name: string]: IconProps["icon"] };

const ICON_SETS: readonly { title: string; file: string; icons: IconSet }[] = [
  {
    title: "workspaceIcons",
    file: "workspace-icons.ts",
    icons: workspaceIcons,
  },
  { title: "launcherIcons", file: "launcher-icons.ts", icons: launcherIcons },
  { title: "editorIcons", file: "editor-icons.ts", icons: editorIcons },
  {
    title: "lophnSpaceIcons",
    file: "lophn-space-icons.ts",
    icons: lophnSpaceIcons,
  },
  { title: "appSpaceIcons", file: "app-space-icons.ts", icons: appSpaceIcons },
  { title: "paletteIcons", file: "palette-icons.ts", icons: paletteIcons },
  {
    title: "conversationIcons",
    file: "conversation-icons.ts",
    icons: conversationIcons,
  },
  {
    title: "chrome-icons",
    file: "chrome-icons.ts",
    icons: {
      lophnEntryIcon,
      retryIcon,
      connectionFailedIcon,
      connectionStaleIcon,
      launcherEmptyIcon,
    },
  },
  { title: "STATUS_ICONS", file: "status-mark.tsx", icons: STATUS_ICONS },
];

/** Tokens · icons. */
export function TokensIcons() {
  return (
    <Page>
      <p className={kit.note}>
        아이콘은 화면이 lucide를 직접 들이지 않도록 design이 묶음으로 고른다.
        크기는 14·16·20px, 선은 1.5다.
      </p>
      {ICON_SETS.map((set) => (
        <Section
          key={set.title}
          title={set.title}
          note={`packages/design/components/${set.file}`}
        >
          <div className={kit.grid}>
            {Object.entries(set.icons).map(([name, icon]) => (
              <div key={name} className={kit.iconCell}>
                <Icon icon={icon} pixels={iconPixels("large")} />
                <span className={kit.iconName}>{name}</span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </Page>
  );
}
