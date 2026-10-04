import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import styles from "./entry.module.css";

mount(
  <div className={styles.root}>
    <Desktop source={windowCoreSource()} />
  </div>,
);
