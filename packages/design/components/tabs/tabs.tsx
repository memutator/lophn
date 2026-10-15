import type { ReactNode } from "react";
import * as Radix from "@radix-ui/react-tabs";
import { componentMark, type ControlSize, cx } from "../shared.ts";
import styles from "./tabs.module.css";

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

// 일반 탭이다. 작업대 문서 탭 모양은 shell/editor가 따로 둔다.
export function Tabs(props: TabsProps) {
  return (
    <Radix.Root {...props} className={styles.root} {...componentMark("Tabs")} />
  );
}

export function TabList({ children }: { children: ReactNode }) {
  return (
    <Radix.List className={styles.list} {...componentMark("TabList")}>
      {children}
    </Radix.List>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  size?: ControlSize;
}

// 같은 크기의 Button·Input·Select와 높이·좌우 여백·기준선이 같다.
export function Tab({ value, children, disabled, size = "md" }: TabProps) {
  return (
    <Radix.Trigger
      value={value}
      disabled={disabled}
      data-size={size}
      className={cx(styles.tab, styles[size])}
      {...componentMark("Tab")}
    >
      {children}
    </Radix.Trigger>
  );
}

export function TabPanel(
  { value, children }: { value: string; children: ReactNode },
) {
  return (
    <Radix.Content
      value={value}
      className={styles.panel}
      {...componentMark("TabPanel")}
    >
      {children}
    </Radix.Content>
  );
}
