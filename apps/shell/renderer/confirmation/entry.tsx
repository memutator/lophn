import { mount } from "../entry.tsx";
import { ConfirmationApp } from "./main.tsx";
import styles from "./entry.module.css";

mount(
  <div className={styles.root}>
    <ConfirmationApp />
  </div>,
);
