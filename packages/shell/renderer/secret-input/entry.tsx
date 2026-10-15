import { mount } from "../entry.tsx";
import { SecretInputApp } from "./main.tsx";
import styles from "./entry.module.css";

mount(
  <div className={styles.root}>
    <SecretInputApp />
  </div>,
);
