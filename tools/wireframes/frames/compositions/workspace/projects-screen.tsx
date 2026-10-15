// Lophn Workspace › Projects. 목록(등록, 보관한 project)과 상세(이름 하나, 목적, 폴더와 폴더 설명, 폴더 안의
// 하위 폴더와 그 설명, 보관). tracking, 문서 수, 문서 정리, export는 없다.
import { useState } from "react";
import {
  Button,
  Card,
  Field,
  Icon,
  iconPixels,
  Input,
  StatusMark,
  Textarea,
} from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { ARCHIVED_PROJECTS, type FolderInfo, PROJECTS } from "./data.ts";
import c from "../compose.module.css";
import { RegisterPanel } from "./register-panel.tsx";
import styles from "./workspace.module.css";

export interface ProjectsScreenProps {
  /** 처음에 고른 project. 기본은 첫 project. */
  readonly selected?: string;
  /** 이 경로의 등록 폴더가 사라진 상태로 그린다. */
  readonly missingFolder?: string;
  /** 하위 폴더 고치기: 첫 하위 폴더의 설명을 고쳤고 마지막 하위 폴더를 뺀 상태. */
  readonly editSubfolders?: boolean;
}

function Subfolders(
  { folder, lost, editing }: {
    folder: FolderInfo;
    lost: boolean;
    editing: boolean;
  },
) {
  const subfolders = folder.subfolders ?? [];
  const lastIndex = subfolders.length - 1;
  return (
    <div className={styles.subfolders}>
      <div className={styles.subHead}>
        <span className={styles.subTitle}>Subfolders</span>
        <Button size="sm" icon={lophnSpaceIcons.add} disabled={lost}>
          Add subfolder
        </Button>
      </div>
      {subfolders.length === 0
        ? (
          <p className={styles.muted}>
            {lost
              ? "Choose the folder's new location before adding subfolders."
              : "No subfolders. Add one to describe a part of this folder."}
          </p>
        )
        : (
          <ul className={styles.subfolderList}>
            {subfolders.map((sub, index) =>
              editing && index === lastIndex
                ? (
                  <li key={sub.path} className={styles.subfolderRemoved}>
                    <span>
                      <span className={styles.path}>{sub.path}</span>{" "}
                      removed from the project. The folder itself is untouched.
                    </span>
                    <Button size="sm">Undo</Button>
                  </li>
                )
                : (
                  <li key={sub.path} className={styles.subfolder}>
                    <div className={styles.folderHead}>
                      <span className={styles.path}>{sub.path}</span>
                      <Button size="sm" variant="ghost">Remove</Button>
                    </div>
                    <Field
                      label="Subfolder description"
                      help={editing && index === 0
                        ? "Edited. Save changes to keep it."
                        : undefined}
                    >
                      <Input
                        size="sm"
                        defaultValue={editing && index === 0
                          ? "Experiment runs, results and score tables"
                          : sub.description}
                      />
                    </Field>
                  </li>
                )
            )}
          </ul>
        )}
    </div>
  );
}

export function ProjectsScreen(
  { selected: initial = "phroner", missingFolder, editSubfolders = false }:
    ProjectsScreenProps = {},
) {
  const [selected, setSelected] = useState(initial);
  const [registering, setRegistering] = useState(false);
  const project = PROJECTS.find((item) => item.id === selected) ?? PROJECTS[0];
  return (
    <div className={styles.screen}>
      <div className={styles.listColumn}>
        {PROJECTS.map((item) => {
          const lost = item.folders.some((folder) =>
            folder.path === missingFolder
          );
          return (
            <div
              key={item.id}
              className={item.id === project.id ? c.selected : undefined}
              aria-current={item.id === project.id ? "true" : undefined}
            >
              <Card>
                <button
                  type="button"
                  className={styles.projectButton}
                  onClick={() => setSelected(item.id)}
                >
                  <span className={styles.projectName}>{item.name}</span>
                  <span className={styles.muted}>{item.purpose}</span>
                  {lost
                    ? <StatusMark tone="warning" label="Folder not found" />
                    : null}
                </button>
              </Card>
            </div>
          );
        })}
        <button
          type="button"
          className={styles.addRound}
          aria-label="Register project"
          title="Register project"
          onClick={() => setRegistering(true)}
        >
          <Icon icon={lophnSpaceIcons.add} pixels={iconPixels("large")} />
        </button>
        <h2 className={styles.groupTitle}>Archived</h2>
        {ARCHIVED_PROJECTS.map((item) => (
          <div key={item.name} className={styles.archivedRow}>
            <span>{item.name}</span>
            <Button size="sm" icon={lophnSpaceIcons.unarchive}>
              Unarchive
            </Button>
          </div>
        ))}
      </div>
      <section className={styles.detail} aria-label={`Project ${project.name}`}>
        <h1 className={styles.detailTitle}>{project.name}</h1>
        <Field label="Name">
          <Input defaultValue={project.name} />
        </Field>
        <Field
          label="Purpose"
          help="What the project is for. Agents read this."
        >
          <Textarea rows={2} defaultValue={project.purpose} />
        </Field>
        <div>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Folders</h2>
            <Button size="sm" icon={lophnSpaceIcons.add}>Add folder</Button>
          </div>
          <ul className={styles.folderList}>
            {project.folders.map((folder) => {
              const lost = folder.path === missingFolder;
              return (
                <li key={folder.path} className={styles.folder}>
                  <div className={styles.folderHead}>
                    <span
                      className={`${styles.path} ${
                        lost ? styles.pathMissing : ""
                      }`}
                    >
                      {folder.path}
                    </span>
                    <span className={styles.folderActions}>
                      {lost
                        ? (
                          <>
                            <StatusMark tone="warning" label="Not found" />
                            <Button size="sm" variant="primary">
                              Choose new location
                            </Button>
                          </>
                        )
                        : null}
                      <Button size="sm" variant="ghost">Remove</Button>
                    </span>
                  </div>
                  <Field label="Folder description">
                    <Input size="sm" defaultValue={folder.description} />
                  </Field>
                  <Subfolders
                    folder={folder}
                    lost={lost}
                    editing={editSubfolders && folder === project.folders[0]}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        <div className={styles.actions}>
          <Button variant="primary">Save changes</Button>
        </div>
        <div className={styles.dangerZone}>
          <p className={styles.muted}>
            Archiving hides the project from the launcher. Its sessions stay,
            but agents stop reacting to new events until you unarchive it.
          </p>
          <Button variant="danger" icon={lophnSpaceIcons.archive}>
            Archive project
          </Button>
        </div>
      </section>
      {registering
        ? <RegisterPanel onClose={() => setRegistering(false)} />
        : null}
    </div>
  );
}
