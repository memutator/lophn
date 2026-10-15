// 런처. project 카드에서 tracking 상태, gitignore 줄, 문서 수, project id 줄을 뺐다.
// 등록 dialog는 이름, 목적, 폴더와 폴더 설명이고 짧은 이름 고르기는 없다.
// Workspace로 들어가는 단추의 이름은 "Lophn Workspace"다.
import type { ReactNode } from "react";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  iconPixels,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import {
  appSpaceIcons,
  launcherEmptyIcon,
  launcherIcons,
  lophnEntryIcon,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import {
  TopBar,
  Wordmark,
} from "../../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { RegisterPanel } from "./register-panel.tsx";
import launcher from "../../../../../packages/shell/renderer/desktop/launcher/launcher.module.css";
import { APPS, PROJECTS } from "./data.ts";

function Entry() {
  return (
    <Button icon={lophnEntryIcon} data-entry="lophn">Lophn Workspace</Button>
  );
}

function LauncherWindow(
  { children, overlay }: {
    children: ReactNode;
    overlay?: ReactNode;
  },
) {
  return (
    <div className={launcher.window} data-space="launcher">
      <TopBar
        platform="linux"
        leading={<Wordmark>lophn</Wordmark>}
        trailing={<Entry />}
      />
      <main className={launcher.scroll}>{children}</main>
      {overlay}
    </div>
  );
}

function ProjectCard(
  { name, purpose, folders, missing }: {
    name: string;
    purpose: string;
    folders: number;
    missing?: boolean;
  },
) {
  return (
    <article className={launcher.card} data-card="project">
      <div className={launcher.cardHead}>
        <button type="button" className={launcher.cardOpen}>
          <Icon
            icon={launcherIcons.project}
            pixels={iconPixels("base")}
            className={launcher.cardIcon}
          />
          <span className={launcher.cardTitle}>{name}</span>
        </button>
        <span className={launcher.cardAside}>
          <Tooltip content="Show details">
            <IconButton
              icon={launcherIcons.expand}
              label="Show details"
              size="sm"
              aria-expanded={false}
            />
          </Tooltip>
        </span>
      </div>
      <p className={launcher.cardPurpose}>{purpose}</p>
      {missing
        ? <StatusMark tone="warning" label="Folder not found" />
        : (
          <p className={launcher.cardStatus}>
            {folders === 1 ? "1 folder" : `${folders} folders`}
          </p>
        )}
    </article>
  );
}

const MISSING_PROJECT = "phroner";

/** 카드가 있는 런처. */
export function LauncherProjects() {
  return (
    <LauncherWindow>
      <div className={launcher.page} data-column="launcher">
        <section className={launcher.section} data-section="projects">
          <div className={launcher.sectionHead}>
            <h2 className={launcher.sectionTitle}>
              Projects
              <span className={launcher.count}>{PROJECTS.length}</span>
            </h2>
            <Tooltip content="Register project">
              <IconButton
                icon={launcherIcons.register}
                label="Register project"
              />
            </Tooltip>
          </div>
          <ul className={launcher.grid}>
            {PROJECTS.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  name={project.name}
                  purpose={project.purpose}
                  folders={project.folders.length}
                  missing={project.id === MISSING_PROJECT}
                />
              </li>
            ))}
          </ul>
        </section>
        <section className={launcher.section} data-section="apps">
          <div className={launcher.sectionHead}>
            <h2 className={launcher.sectionTitle}>
              Apps
              <span className={launcher.count}>3</span>
            </h2>
          </div>
          <ul className={launcher.grid}>
            {APPS.slice(0, 3).map((app) => (
              <li key={app.name}>
                <article className={launcher.card} data-card="app">
                  <div className={launcher.cardHead}>
                    <button type="button" className={launcher.cardOpen}>
                      <Icon
                        icon={appSpaceIcons.app}
                        pixels={iconPixels("base")}
                        className={launcher.cardIcon}
                      />
                      <span className={launcher.cardTitle}>{app.name}</span>
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </LauncherWindow>
  );
}

/** 프로젝트도 앱도 없는 런처. 다음 행동은 Lophn Workspace 하나다. */
export function LauncherEmpty() {
  return (
    <LauncherWindow>
      <div className={launcher.page} data-column="launcher">
        <section className={launcher.emptyCard} data-cards="empty">
          <EmptyState
            icon={launcherEmptyIcon}
            message="Nothing to open yet. Register a project or an app in Lophn Workspace."
            action={{ label: "Lophn Workspace", onSelect: () => {} }}
          />
        </section>
      </div>
    </LauncherWindow>
  );
}

/** 등록 dialog를 연 런처. */
export function LauncherRegister() {
  return (
    <LauncherWindow overlay={<RegisterPanel />}>
      <div className={launcher.page} data-column="launcher">
        <section className={launcher.section} data-section="projects">
          <div className={launcher.sectionHead}>
            <h2 className={launcher.sectionTitle}>
              Projects
              <span className={launcher.count}>{PROJECTS.length}</span>
            </h2>
          </div>
          <ul className={launcher.grid}>
            {PROJECTS.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  name={project.name}
                  purpose={project.purpose}
                  folders={project.folders.length}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </LauncherWindow>
  );
}
