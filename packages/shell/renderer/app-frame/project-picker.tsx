// 앱 place에서 연 앱 공간은 project를 모른다. view는 project 없이 먼저 열려 있고, 그 위에 이 고르기를 얹는다.
// native view가 DOM을 가리므로 고르는 동안 이 자리가 view를 덮은 것으로 알린다(useViewCover). 고르면 부르는 쪽이
// main에 project를 알리고 view를 다시 보인다.
import { type ReactElement, useEffect, useRef, useState } from "react";
import { List, ListItem } from "@lophn/ui/data";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { useViewCover } from "./embedded-view.tsx";
import styles from "./project-picker.module.css";

interface ProjectChoice {
  readonly id: string;
  readonly name: string;
  /** 목록 줄의 보조 글. 폴더 경로. */
  readonly folder: string;
}

/** project 목록을 읽는 함수. */
export type ProjectsRead = () => Promise<
  | { readonly ok: true; readonly value: readonly ProjectChoice[] }
  | { readonly ok: false }
>;

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly projects: readonly ProjectChoice[] };

interface ProjectPickerProps {
  appName: string;
  projects: ProjectsRead;
  onPick: (project: string) => void;
  /** 고른 project를 main이 받지 않았다. */
  failed: boolean;
}

export function ProjectPicker(
  { appName, projects, onPick, failed }: ProjectPickerProps,
): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useViewCover(ref, true);
  // 고르는 동안은 modal이다. 창 위쪽 줄도 같은 scrim으로 덮는다(chrome.css).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.pageModal = "";
    return () => {
      delete root.dataset.pageModal;
    };
  }, []);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    void projects().then((read) => {
      if (!live) return;
      setLoaded(
        read.ok
          ? { state: "ready", projects: read.value }
          : { state: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [projects, attempt]);
  return (
    <div ref={ref} className={styles.scrim} data-project-picker="">
      <div
        className={styles.picker}
        role="group"
        aria-label={t("app-space.heading.choose-project")}
      >
        <h3 className={styles.title}>
          {t("app-space.heading.choose-project")}
        </h3>
        <p className={styles.text}>
          {t("app-space.text.choose-project", { app: appName })}
        </p>
        {failed
          ? (
            <p className={styles.failure} role="alert">
              {t("app-space.error.project-failed")}
            </p>
          )
          : null}
        {loaded.state === "failed"
          ? (
            <ErrorState
              target={t("app-space.label.your-projects")}
              onRetry={() => setAttempt((count) => count + 1)}
            />
          )
          : (
            <Loading
              loading={loaded.state === "loading"}
              placeholder={<Skeleton lines={3} />}
            >
              {loaded.state === "ready" && loaded.projects.length === 0
                ? (
                  <p className={styles.text}>
                    {t("app-space.empty.no-projects")}
                  </p>
                )
                : (
                  <List>
                    {loaded.state === "ready"
                      ? loaded.projects.map((project) => (
                        <ListItem
                          key={project.id}
                          title={project.name}
                          meta={project.folder}
                          onSelect={() => onPick(project.id)}
                        />
                      ))
                      : null}
                  </List>
                )}
            </Loading>
          )}
      </div>
    </div>
  );
}
