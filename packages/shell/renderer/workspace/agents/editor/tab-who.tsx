// Who 탭(누구): profile · Name · Handle · Role(description) · 명함 · 지우기.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
import { useState } from "react";
import { Field, Input } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { actionIcons } from "../../../icons/mod.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import { codingFaceOf } from "../coding-face.ts";
import { CardFacts } from "../agent-card.tsx";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  type Ready,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { ProfileField } from "./parts.tsx";
import styles from "./agent-editor.module.css";

// 지우기는 확인을 한 번 받은 뒤에만 부른다. 저장은 확인이 없다.
function DeleteAgent({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className={styles.danger}>
      <Button icon={actionIcons.delete} onClick={() => setAsking(true)}>
        {t("project-workspace.button.agent-editor-delete")}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("project-workspace.heading.agent-editor-delete-title", {
          name,
        })}
        actions={
          <>
            <Button onClick={() => setAsking(false)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              onClick={() => {
                setAsking(false);
                onDelete();
              }}
            >
              {t("project-workspace.button.agent-editor-delete-confirm")}
            </Button>
          </>
        }
      >
        <p>{t("project-workspace.notice.agent-editor-delete-body")}</p>
      </Dialog>
    </div>
  );
}

interface WhoTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly copyOf: Ready["copyOf"];
  readonly imageSrc: (image: string) => string;
  readonly onUpload: (file: File) => void;
  readonly onDelete: () => void;
}

export function WhoTab(props: WhoTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { fresh, lophn, coding } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  const profile = definition.profile ?? detail.effective.profile.value;
  // 내장 coding agent의 얼굴은 그 제품 아이콘이고 고르지 않는다.
  const shownProfile =
    (detail.assignment === null
      ? undefined
      : codingFaceOf(detail.assignment)) ??
    (profile.kind === "character"
      ? profile
      : { kind: "image" as const, src: props.imageSrc(profile.image) });
  const name = definition.name ?? detail.effective.name.value;

  return (
    <div className={styles.form}>
      {lophn || coding ? (
        <Group
          name="profile"
          heading={t("project-workspace.heading.agent-editor-profile")}
        >
          <Avatar profile={shownProfile} size="lg" />
        </Group>
      ) : (
        <>
          <ProfileField
            value={profile}
            imageSrc={props.imageSrc}
            canUpload={!fresh}
            onChange={(next) => set("profile", next)}
            onUpload={props.onUpload}
          />
          {props.copyOf?.imageDropped ? (
            <p className={styles.note} data-copy-image="">
              {t("agents.notice.copy-image")}
            </p>
          ) : null}
          <Issues issues={issues("profile")} />
        </>
      )}

      <div data-field="name">
        <Field label={t("project-workspace.label.agent-editor-name")}>
          <Input
            value={name}
            aria-invalid={issues("name").length > 0 || undefined}
            onChange={(event) => set("name", event.currentTarget.value)}
          />
        </Field>
        <Issues issues={issues("name")} />
      </div>

      {lophn ? (
        <p className={styles.note} data-fixed-handle="">
          {t("agents.notice.handle-fixed-lophn")}
        </p>
      ) : (
        <div data-field="handle">
          <Field
            label={t("agents.label.handle")}
            help={t("agents.notice.handle-help")}
          >
            <Input
              value={definition.handle ?? ""}
              readOnly={!fresh}
              aria-invalid={issues("handle").length > 0 || undefined}
              onChange={(event) =>
                set(
                  "handle",
                  event.currentTarget.value === ""
                    ? undefined
                    : event.currentTarget.value,
                )
              }
            />
          </Field>
          <Issues issues={issues("handle")} />
        </div>
      )}

      {lophn ? null : (
        <div data-field="description">
          <Field
            label={t("agents.label.description")}
            help={t("agents.notice.description-help")}
          >
            <Input
              value={definition.description ?? ""}
              aria-invalid={issues("description").length > 0 || undefined}
              onChange={(event) =>
                set(
                  "description",
                  event.currentTarget.value === ""
                    ? undefined
                    : event.currentTarget.value,
                )
              }
            />
          </Field>
          <Issues issues={issues("description")} />
        </div>
      )}

      {detail.card === undefined ? null : (
        <Group name="card" heading={t("agents.heading.card")}>
          <CardFacts card={detail.card} workspaceName={props.workspaceName} />
          <p className={styles.note}>{t("agents.notice.card-help")}</p>
        </Group>
      )}

      <p className={styles.note}>{t("agents.notice.stored-in-lophn")}</p>
      {!fresh && !lophn && !coding ? (
        <DeleteAgent name={name} onDelete={props.onDelete} />
      ) : null}
    </div>
  );
}
