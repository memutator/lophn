// 대화 글 한 덩이. 이 project의 domain artifact path는 누르면 artifact 탭을 여는 link가 되고, 나머지는 글 그대로다.
// agent 글(markdown)은 ChatMarkdown이 글 조각마다 artifactPieces를 부른다.
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { artifactMentions } from "../../../../protocol/domains/artifact.ts";
import {
  DOMAIN_ARTIFACTS_FOLDER,
  DOMAINS_AREA,
} from "../../../../protocol/domains/paths.ts";
import { artifactIcons } from "../../icons/mod.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import styles from "./message-body.module.css";

const NAMED = new RegExp(
  `(?:^|/)${DOMAINS_AREA}/(dom_[0-9a-z]+)/${DOMAIN_ARTIFACTS_FOLDER}/([a-z][a-z0-9-]*)`,
  "g",
);

/** agent가 방금 만든 artifact는 목록에 아직 없다. 모르는 (domain, name)이 글에 나오면 목록을 이름당 한 번 다시 읽는다. */
export function useArtifactReload(
  text: string,
  artifacts: ArtifactsSlice | undefined,
): void {
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (artifacts === undefined) return;
    for (const match of text.matchAll(NAMED)) {
      const domain = match[1]!;
      const name = match[2]!;
      const id = `${domain}/${name}`;
      if (
        artifacts.names.some((one) =>
          one.domain === domain && one.name === name
        ) ||
        asked.current.has(id)
      ) continue;
      asked.current.add(id);
      artifacts.reload();
    }
  }, [text, artifacts]);
}

/** 글 안 artifact path 하나. 누르면 그 탭을 열고, hover하면 title·description과 열기 안내가 보인다. */
export function ArtifactLink(
  { artifacts, domain, name, label }: {
    artifacts: ArtifactsSlice;
    domain: string;
    name: string;
    label: string;
  },
): ReactElement {
  const item = artifacts.items.find((one) =>
    one.domain === domain && one.name === name
  );
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
        onClick={() => artifacts.open(domain, name)}
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
  const mentions = artifactMentions(text, artifacts.names);
  if (mentions.length === 0) return undefined;
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const { start, end, domain, name } of mentions) {
    pieces.push(
      text.slice(at, start),
      <ArtifactLink
        key={start}
        artifacts={artifacts}
        domain={domain}
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
export function ArtifactText(
  { text, artifacts }: { text: string; artifacts?: ArtifactsSlice | undefined },
): ReactElement {
  useArtifactReload(text, artifacts);
  const pieces = artifacts === undefined
    ? undefined
    : artifactPieces(text, artifacts);
  return <p className={styles.text}>{pieces ?? text}</p>;
}
