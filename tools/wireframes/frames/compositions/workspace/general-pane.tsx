// Settings › General. 요소가 선언한 설정 항목을 타입(불리언, 숫자 범위, 선택지, 목록)대로 보고 바꾼다.
// 사람이 정한 값만 저장하고 기본값과 나눠 보인다. 틀린 값은 거절 이유를 보인다.
// 효력 시점 줄, revision, 지침·skill 같은 내용물, 창 크기 같은 상태는 없다.
import {
  Button,
  Icon,
  IconButton,
  iconPixels,
  Input,
  Select,
  Switch,
} from "@lophn/design/components";
import {
  connectionFailedIcon,
  launcherIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import a from "../agents.module.css";
import c from "../compose.module.css";
import { NamedControl } from "./named-control.tsx";
import styles from "./workspace.module.css";

interface Common {
  readonly key: string;
  readonly name: string;
  readonly help: string;
  /** 사람이 정한 값이 있으면 그 값의 기본값 글. */
  readonly setBy?: string;
  readonly defaultText: string;
}

interface Bool extends Common {
  readonly type: "boolean";
  readonly value: boolean;
}

interface Range extends Common {
  readonly type: "range";
  readonly value: string;
  readonly min: number;
  readonly max: number;
  /** 사람이 입력했지만 거절된 값과 이유. 저장된 값은 그대로다. */
  readonly rejected?: { readonly typed: string; readonly reason: string };
}

interface Choice extends Common {
  readonly type: "choice";
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
}

interface List extends Common {
  readonly type: "list";
  readonly value: readonly string[];
}

type Setting = Bool | Range | Choice | List;

interface Group {
  readonly title: string;
  readonly settings: readonly Setting[];
}

const GROUPS: readonly Group[] = [
  {
    title: "Agents",
    settings: [
      {
        key: "agents.model.catalog_auto_update",
        type: "boolean",
        name: "Update the model catalog automatically",
        help: "Fetch the list of models each provider offers.",
        value: false,
        setBy: "set",
        defaultText: "On",
      },
      {
        key: "agents.run.max_tool_calls",
        type: "range",
        name: "Tool calls per turn",
        help: "A turn stops after this many tool calls.",
        value: "80",
        min: 1,
        max: 200,
        setBy: "set",
        defaultText: "50",
        rejected: {
          typed: "500",
          reason:
            "500 is above the maximum of 200. Nothing was saved; the value stays 80.",
        },
      },
      {
        key: "agents.run.max_minutes",
        type: "range",
        name: "Minutes per turn",
        help: "A turn is interrupted after this long.",
        value: "30",
        min: 1,
        max: 120,
        defaultText: "30",
      },
    ],
  },
  {
    title: "Projects",
    settings: [
      {
        key: "projects.search.skip_patterns",
        type: "list",
        name: "Extra patterns to skip in project search",
        help: "Added to the patterns from .gitignore.",
        value: ["*.log", "dist/"],
        setBy: "set",
        defaultText: "Empty",
      },
    ],
  },
  {
    title: "Problems",
    settings: [
      {
        key: "problems.detail_collection",
        type: "boolean",
        name: "Collect problem details",
        help: "Keep a snapshot with each reported problem.",
        value: true,
        defaultText: "On",
      },
    ],
  },
  {
    title: "Desktop",
    settings: [
      {
        key: "shell.reading_width",
        type: "choice",
        name: "Reading width",
        help: "How wide documents are laid out when you read them.",
        value: "wide",
        options: [
          { value: "narrow", label: "Narrow" },
          { value: "standard", label: "Standard" },
          { value: "wide", label: "Wide" },
        ],
        setBy: "set",
        defaultText: "Standard",
      },
    ],
  },
];

/** 줄의 오른쪽 고정 열에 놓이는 입력. 이름은 줄 왼쪽에 있다. */
function Control({ setting }: { setting: Setting }) {
  switch (setting.type) {
    case "boolean":
      return (
        <div className={styles.endSlot}>
          <Switch
            label={setting.value ? "On" : "Off"}
            defaultChecked={setting.value}
          />
        </div>
      );
    case "range":
      return (
        <Input
          type="number"
          min={setting.min}
          max={setting.max}
          defaultValue={setting.rejected?.typed ?? setting.value}
        />
      );
    case "choice":
      return <Select options={setting.options} defaultValue={setting.value} />;
    case "list":
      return (
        <div className={styles.endSlot}>
          <Button size="sm" icon={launcherIcons.addRule}>Add pattern</Button>
        </div>
      );
  }
}

function SettingRow({ setting }: { setting: Setting }) {
  const changed = setting.setBy !== undefined;
  const rejected = setting.type === "range" ? setting.rejected : undefined;
  const help = setting.type === "range"
    ? `${setting.help} Allowed: ${setting.min} to ${setting.max}.`
    : setting.help;
  return (
    <li className={styles.setting}>
      <NamedControl
        name={setting.name}
        invalid={rejected !== undefined}
        labelClass={styles.settingName}
      >
        {({ label, provide }) => (
          <>
            <div className={styles.settingMain}>
              {label}
              <span className={styles.muted}>{help}</span>
              {setting.type === "list"
                ? (
                  <ul className={styles.tokens}>
                    {setting.value.map((item) => (
                      <li key={item} className={styles.token}>
                        {item}
                        <IconButton
                          icon={launcherIcons.remove}
                          label={`Remove ${item}`}
                          size="sm"
                        />
                      </li>
                    ))}
                  </ul>
                )
                : null}
              {rejected === undefined
                ? null
                : (
                  <span className={styles.rejected} role="alert">
                    <Icon
                      icon={connectionFailedIcon}
                      pixels={iconPixels("base")}
                    />
                    {rejected.reason}
                  </span>
                )}
              <span className={styles.caption}>
                <span className={styles.mono}>{setting.key}</span>
                {changed
                  ? ` · Set by you · Default: ${setting.defaultText}`
                  : " · Default"}
              </span>
            </div>
            <div className={styles.settingReset}>
              {changed
                ? <Button size="sm" variant="ghost">Reset to default</Button>
                : null}
            </div>
            <div className={styles.settingControl}>
              {provide(<Control setting={setting} />)}
            </div>
          </>
        )}
      </NamedControl>
    </li>
  );
}

export function GeneralPane() {
  return (
    <div className={a.setPage}>
      <h1 className={c.searchTitle}>General</h1>
      <p className={a.setLead}>
        Settings that lophn declares. Only values you change are saved; every
        other value follows its default.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} className={a.setSection}>
          <h2 className={a.setSectionTitle}>{group.title}</h2>
          <ul className={styles.group}>
            {group.settings.map((setting) => (
              <SettingRow key={setting.key} setting={setting} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
