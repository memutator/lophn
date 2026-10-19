// 대화 글 한 덩이. 이 project의 domain artifact path는 누르면 artifact 탭을 여는 link가 되고, 나머지는 글 그대로다.
import { Fragment, type ReactElement, useEffect, useRef } from "react";
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

export function ArtifactText(
  { text, artifacts }: { text: string; artifacts?: ArtifactsSlice | undefined },
): ReactElement {
  // agent가 방금 만든 artifact는 목록에 아직 없다. 모르는 (domain, name)이 글에 나오면 목록을 이름당 한 번 다시 읽는다.
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

  const mentions = artifacts === undefined
    ? []
    : artifactMentions(text, artifacts.names);
  if (artifacts === undefined || mentions.length === 0) {
    return <p className={styles.text}>{text}</p>;
  }
  const parts: ReactElement[] = [];
  let at = 0;
  for (const { start, end, domain, name } of mentions) {
    const item = artifacts.items.find((one) =>
      one.domain === domain && one.name === name
    );
    parts.push(
      <Fragment key={start}>
        {text.slice(at, start)}
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
            {text.slice(start, end)}
          </button>
        </Tooltip>
      </Fragment>,
    );
    at = end;
  }
  return <p className={styles.text}>{parts}{text.slice(at)}</p>;
}
