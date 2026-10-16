import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Field,
  Icon,
  IconButton,
  iconPixels,
  Input,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";
import { launcherIcons } from "../../../icons/mod.ts";

import formStyles from "../../launcher/register-dialog.module.css";
import { joinPath } from "./model.ts";
import type { ProjectsSource, SubfolderItem } from "./source.ts";
import styles from "./subfolder-picker.module.css";

export interface SubfolderPickerProps {
  open: boolean;
  /** 등록 폴더의 절대 경로. 트리의 맨 위이고 그 위로는 올라갈 수 없다. */
  root: string;
  /** 이미 더한 하위 폴더의 상대 경로. */
  added: readonly string[];
  source: Pick<ProjectsSource, "listFolders">;
  onClose: () => void;
  onAdd: (subfolder: SubfolderItem) => void;
}

type Children = Readonly<
  Record<string, readonly string[] | "loading" | "failed">
>;

const ROOT = "";

const childPath = (parent: string, name: string) =>
  parent === ROOT ? name : `${parent}/${name}`;

// 등록 폴더 안만 한 단계씩 읽어 펼친다. OS 폴더 선택기가 아니라 목록이라 등록 폴더 밖으로 나갈 길이 없다.
export function SubfolderPicker(
  { open, root, added, source, onClose, onAdd }: SubfolderPickerProps,
) {
  const [children, setChildren] = useState<Children>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set([ROOT]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  const load = async (parent: string) => {
    setChildren((current) => ({ ...current, [parent]: "loading" }));
    const read = await source.listFolders(joinPath(root, parent));
    setChildren((current) => ({
      ...current,
      [parent]: read.ok ? read.value : "failed",
    }));
  };

  useEffect(() => {
    if (!open) return;
    setChildren({});
    setExpanded(new Set([ROOT]));
    setSelected(null);
    setDescription("");
    void load(ROOT);
  }, [open, root]);

  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (children[path] === undefined) void load(path);
    }
    setExpanded(next);
  };

  const rows = (parent: string) => {
    const list = children[parent];
    if (list === undefined || list === "loading") {
      return (
        <li aria-busy="true">
          <Skeleton lines={1} />
        </li>
      );
    }
    if (list === "failed") {
      return (
        <li className={styles.error} role="alert">
          {t("projects.error.folders-unavailable")}
        </li>
      );
    }
    return list.map((name) => {
      const path = childPath(parent, name);
      const isAdded = added.includes(path);
      const isOpen = expanded.has(path);
      return (
        <li key={path} role="treeitem" aria-expanded={isOpen}>
          <div
            className={styles.row}
            aria-selected={selected === path}
            aria-disabled={isAdded}
          >
            <IconButton
              icon={isOpen ? launcherIcons.collapse : launcherIcons.expand}
              label={name}
              size="sm"
              data-expand={path}
              onClick={() => toggle(path)}
            />
            <button
              type="button"
              className={styles.pick}
              disabled={isAdded}
              data-pick={path}
              onClick={() => setSelected(path)}
            >
              <Icon
                icon={launcherIcons.project}
                pixels={iconPixels("base")}
              />
              <span>{`${name}/`}</span>
              {isAdded
                ? (
                  <span className={styles.caption}>
                    {t("projects.label.added")}
                  </span>
                )
                : null}
            </button>
          </div>
          {isOpen
            ? <ul role="group" className={styles.group}>{rows(path)}</ul>
            : null}
        </li>
      );
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("projects.title.add-subfolder")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={selected === null}
            data-add-subfolder-confirm=""
            onClick={() => {
              if (selected === null) return;
              onAdd({ path: selected, description: description.trim() });
            }}
          >
            {t("projects.button.add-subfolder")}
          </Button>
        </>
      }
    >
      <div className={formStyles.form}>
        <p className={formStyles.note}>
          {t("projects.notice.pick-subfolder")}
        </p>
        <ul className={styles.tree} role="tree">
          <li>
            <div className={`${styles.row} ${styles.root}`}>
              <Icon icon={launcherIcons.project} pixels={iconPixels("base")} />
              <span className={styles.mono}>{root}</span>
            </div>
            <ul role="group" className={styles.group}>{rows(ROOT)}</ul>
          </li>
        </ul>
        <Field label={t("projects.label.subfolder-description")}>
          <Input
            value={description}
            data-subfolder-new-description=""
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
