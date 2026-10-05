import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
import { windowEditorDeps } from "../editor/window-deps.ts";
import { openProject } from "./router.ts";
import styles from "./entry.module.css";

const seed = devSeed();
const core = windowCoreSource();
const editor = windowEditorDeps(core);

mount(
  <div className={styles.root}>
    <Desktop
      source={core}
      initial={seed ? openProject(seed.project) : undefined}
      workspace={seed?.source}
      editor={seed ? { ...editor, ...seed.editor } : editor}
      windowWidth={seed ? 1440 : undefined}
    />
  </div>,
);
