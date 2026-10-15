// 앱 place에서 연 앱 화면이 project를 정하지 못했을 때 shell이 화면 안에 띄우는 project 고르기. 목록은 core에서 받는다.
import { List, ListItem } from "@lophn/design/components";

import styles from "./app-space.module.css";

const PROJECTS = [
  { name: "phroner", meta: "~/Documents/phroner" },
  { name: "grocery", meta: "~/Documents/grocery" },
  { name: "taxes-2026", meta: "~/Documents/taxes-2026" },
] as const;

export function ProjectPicker({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div className={styles.scrim} data-project-picker="">
      <div className={styles.picker} role="group" aria-label="Choose a project">
        <h3 className={styles.appName}>Choose a project</h3>
        <p className={styles.text}>
          Orders needs to know which project this screen is for. It was opened
          from the app list, not from a project.
        </p>
        <List>
          {PROJECTS.map((project) => (
            <ListItem
              key={project.name}
              title={project.name}
              meta={project.meta}
              onSelect={() => onPick(project.name)}
            />
          ))}
        </List>
      </div>
    </div>
  );
}
