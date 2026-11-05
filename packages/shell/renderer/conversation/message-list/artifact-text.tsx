// 대화 글 한 덩이. 이 창 workspace(project나 앱)의 artifact path는 누르면 artifact 탭을 여는 link가 되고, 나머지는 글 그대로다.
// agent 글(markdown)은 ChatMarkdown이 글 조각마다 artifactPieces를 부른다.
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  ARTIFACTS_FOLDER,
  artifactMentions,
} from "../../../../protocol/projects/artifact.ts";
import { artifactIcons } from "../../icons/mod.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import styles from "./message-body.module.css";

const NAMED = new RegExp(
  `(?:^|/)(?:projects|apps)/([a-z]+_[0-9a-z]+)/${ARTIFACTS_FOLDER}/([a-z][a-z0-9-]*)`,
  "g",
);

/** agent가 방금 만든 artifact는 목록에 아직 없다. 이 workspace의 모르는 name이 글에 나오면 목록을 이름당 한 번 다시 읽는다. */
export function useArtifactReload(
  text: string,
  artifacts: ArtifactsSlice | undefined,
): void {
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (artifacts?.workspace == null) return;
    for (const match of text.matchAll(NAMED)) {
      const name = match[2]!;
      if (
        match[1] !== artifacts.workspace.id ||
        artifacts.items.some((one) => one.name === name) ||
        asked.current.has(name)
      )
        continue;
      asked.current.add(name);
      artifacts.reload();
    }
  }, [text, artifacts]);
}

/** 글 안 artifact path 하나. 누르면 그 탭을 열고, hover하면 title·description과 열기 안내가 보인다. */
export function ArtifactLink({
  artifacts,
  name,
  label,
}: {
  artifacts: ArtifactsSlice;
  name: string;
  label: string;
}): ReactElement {
  const item = artifacts.items.find((one) => one.name === name);
  return (
    <Tooltip
      content={
        <span className={styles.hoverCard}>
          <span className={styles.hoverTitle}>{item?.title ?? name}</span>
          {item?.description ? <span>{item.description}</span> : null}
          <span className={styles.hoverAction}>
            {t("artifact.label.open-link")}
          </span>
        </span>
      }
    >
      <button
        type="button"
        className={styles.link}
        data-artifact-link={name}
        onClick={() => artifacts.open(name)}
      >
        <Icon icon={artifactIcons.kind} pixels={iconPixels("small")} />
        {label}
      </button>
    </Tooltip>
  );
}

/** 글을 아는 artifact path의 link와 나머지 글로 나눈다. 아는 path가 없으면 undefined다. */
export function artifactPieces(
  text: string,
  artifacts: ArtifactsSlice,
): ReactNode[] | undefined {
  if (artifacts.workspace === null) return undefined;
  const mentions = artifactMentions(
    text,
    artifacts.workspace,
    artifacts.items.map((item) => item.name),
  );
  if (mentions.length === 0) return undefined;
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const { start, end, name } of mentions) {
    pieces.push(
      text.slice(at, start),
      <ArtifactLink
        key={start}
        artifacts={artifacts}
        name={name}
        label={text.slice(start, end)}
      />,
    );
    at = end;
  }
  pieces.push(text.slice(at));
  return pieces;
}

/** 사람 글. markdown으로 읽지 않고 글 그대로 보이며, artifact path만 link가 된다. */
export function ArtifactText({
  text,
  artifacts,
}: {
  text: string;
  artifacts?: ArtifactsSlice | undefined;
}): ReactElement {
  useArtifactReload(text, artifacts);
  const pieces =
    artifacts === undefined ? undefined : artifactPieces(text, artifacts);
  return <p className={styles.text}>{pieces ?? text}</p>;
}
