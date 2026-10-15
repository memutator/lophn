// Settings › Appearance. 화면 모양을 고른다: theme, 글자 크기, 문서 읽기 폭, 화면 밀도.
// 줄은 이름과 설명이 왼쪽이고 고르는 칸이 오른쪽 끝 고정 열이다. Theme은 고르면 바로 바뀐다.
import { Select } from "@lophn/design/components";

import a from "../agents.module.css";
import c from "../compose.module.css";
import { NamedControl } from "./named-control.tsx";
import styles from "./workspace.module.css";

interface Row {
  readonly name: string;
  readonly help: string;
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
  /** 고르면 바로 화면에 적용하는 항목. */
  readonly live?: boolean;
}

const ROWS: readonly Row[] = [
  {
    name: "Theme",
    help: "Light, dark, or follow the system setting.",
    value: "system",
    live: true,
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
      { value: "system", label: "System" },
    ],
  },
  {
    name: "Text size",
    help: "The size of text across lophn.",
    value: "default",
    options: [
      { value: "small", label: "Small" },
      { value: "default", label: "Default" },
      { value: "large", label: "Large" },
    ],
  },
  {
    name: "Reading width",
    help: "How wide documents are laid out when you read them.",
    value: "standard",
    options: [
      { value: "narrow", label: "Narrow" },
      { value: "standard", label: "Standard" },
      { value: "wide", label: "Wide" },
    ],
  },
  {
    name: "Density",
    help: "How much room lists and tables leave between rows.",
    value: "comfortable",
    options: [
      { value: "comfortable", label: "Comfortable" },
      { value: "compact", label: "Compact" },
    ],
  },
];

// System은 data-theme를 지워 OS 설정을 따른다.
function applyTheme(value: string) {
  const root = document.documentElement;
  if (value === "light" || value === "dark") root.dataset.theme = value;
  else delete root.dataset.theme;
}

export function AppearancePane() {
  return (
    <div className={a.setPage}>
      <h1 className={c.searchTitle}>Appearance</h1>
      <p className={a.setLead}>
        How lophn looks. Changes apply as soon as you choose.
      </p>
      <ul className={styles.group}>
        {ROWS.map((row) => (
          <li key={row.name} className={styles.reaction}>
            <NamedControl name={row.name} labelClass={styles.settingName}>
              {({ label, provide }) => (
                <>
                  <div className={styles.reactionInfo}>
                    {label}
                    <span className={styles.muted}>{row.help}</span>
                  </div>
                  <div className={styles.settingControl}>
                    {provide(
                      <Select
                        options={row.options}
                        defaultValue={row.value}
                        onValueChange={row.live ? applyTheme : undefined}
                      />,
                    )}
                  </div>
                </>
              )}
            </NamedControl>
          </li>
        ))}
      </ul>
    </div>
  );
}
