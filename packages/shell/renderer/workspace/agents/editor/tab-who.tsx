// Who 탭(누구): avatar · Name · Handle · Role(description) · 명함 · 지우기.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.

import { t } from "@lophn/i18n";
import { Field, Input } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { useState } from "react";

import type { CleanUpMode } from "../../../../../protocol/base/follow-ups.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import {
  CascadeDeleteActions,
  CascadeImpactDetails,
  useImpact,
} from "../../../shell/cascade-delete-confirm.tsx";
import { CardFacts } from "../agent-card.tsx";
import { codingFaceOf } from "../coding-face.ts";
import styles from "./agent-editor.module.css";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  type Ready,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { AvatarField } from "./parts.tsx";

// 지우기는 확인을 한 번 받은 뒤에만 부른다. 저장은 확인이 없다.
function DeleteAgent({
  agentId,
  name,
  onDelete,
}: {
  agentId: string | null;
  name: string;
  onDelete: (cleanUp: CleanUpMode) => void;
}) {
  const [asking, setAsking] = useState(false);
  const impact = useImpact(
    asking && agentId !== null ? { kind: "agent", agent: agentId } : null,
  );
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
          <CascadeDeleteActions
            report={impact.report}
            loading={impact.loading}
            confirmLabel={t(
              "project-workspace.button.agent-editor-delete-confirm",
            )}
            confirmAction="confirm-delete-agent"
            onCancel={() => setAsking(false)}
            onConfirm={(cleanUp) => {
              setAsking(false);
              onDelete(cleanUp);
            }}
          />
        }
      >
        <p>{t("project-workspace.notice.agent-editor-delete-body")}</p>
        <CascadeImpactDetails report={impact.report} loading={impact.loading} />
      </Dialog>
    </div>
  );
}

interface WhoTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly copyOf: Ready["copyOf"];
  readonly imageSrc: (image: string) => string;
  readonly onUpload: (file: File) => void;
  readonly onDelete: (cleanUp: CleanUpMode) => void;
}

export function WhoTab(props: WhoTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { fresh, lophn, coding } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  const avatar = definition.avatar ?? detail.effective.avatar.value;
  const runtime = definition.runtime ?? detail.definition?.runtime;
  // 내장 coding agent와 기본 character avatar의 harness runtime agent는 그 제품 아이콘으로 구분한다.
  const shownAvatar =
    (detail.assignment === null
      ? undefined
      : avatar.kind === "character"
        ? codingFaceOf(detail.assignment, runtime)
        : codingFaceOf(detail.assignment)) ??
    (avatar.kind === "character"
      ? avatar
      : { kind: "image" as const, src: props.imageSrc(avatar.image) });
  const name = definition.name ?? detail.effective.name.value;

  return (
    <div className={styles.form}>
      {lophn || coding ? (
        <Group
          name="avatar"
          heading={t("project-workspace.heading.agent-editor-avatar")}
        >
          <Avatar look={shownAvatar} size="lg" />
        </Group>
      ) : (
        <>
          <AvatarField
            value={avatar}
            imageSrc={props.imageSrc}
            canUpload={!fresh}
            onChange={(next) => set("avatar", next)}
            onUpload={props.onUpload}
          />
          {props.copyOf?.imageDropped ? (
            <p className={styles.note} data-copy-image="">
              {t("agents.notice.copy-image")}
            </p>
          ) : null}
          <Issues issues={issues("avatar")} />
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
        <DeleteAgent
          agentId={detail.assignment}
          name={name}
          onDelete={props.onDelete}
        />
      ) : null}
    </div>
  );
}
