import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
import { openProject } from "./router.ts";
import styles from "./entry.module.css";

const seed = devSeed();

mount(
  <div className={styles.root}>
    <Desktop
      source={windowCoreSource()}
      initial={seed ? openProject(seed.project) : undefined}
      workspace={seed?.source}
      windowWidth={seed ? 1440 : undefined}
    />
  </div>,
);
