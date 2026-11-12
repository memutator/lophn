// General 탭: profile · Name · Handle · Workspace · Description · 받고 내는 것 · Card · Skip permissions · 지우기.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
import { useState } from "react";
import { Checkbox, Field, Input, SegmentedControl } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type { AgentWorkspace } from "../../../../../protocol/lophn-agent/agent-values.ts";
import { workspaceOfLophn } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import { codingFaceOf } from "../coding-face.ts";
import { CardFacts, scopeLabel } from "../agent-card.tsx";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { ModalityToggles } from "./modality-toggles.tsx";
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

interface GeneralTabProps extends FormProps {
  readonly facts: AgentFacts;
  readonly imageSrc: (image: string) => string;
  readonly onUpload: (file: File) => void;
  readonly onDelete: () => void;
}

export function GeneralTab(props: GeneralTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { fresh, lophn, coding } = facts;
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  // lophn의 정의 file에는 workspace 칸이 없다(id가 말한다).
  const scope =
    detail.assignment !== null && lophn
      ? workspaceOfLophn(detail.assignment)
      : definition.workspace;
  // 새 agent가 고를 수 있는 범위: 화면을 연 workspace. home이나 Settings는 없고 전역뿐이다.
  const here =
    detail.workspace.kind === "none" || detail.workspace.kind === "home"
      ? null
      : ({
          kind: detail.workspace.kind,
          id: detail.workspace.id,
        } as AgentWorkspace);
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

      <div data-field="workspace">
        <Field
          label={t("agents.label.workspace")}
          help={t("agents.notice.workspace-help")}
        >
          {fresh && here !== null ? (
            <SegmentedControl
              size="sm"
              label={t("agents.label.workspace")}
              value={definition.workspace === undefined ? "global" : "here"}
              options={[
                {
                  value: "here",
                  label: scopeLabel(here, props.workspaceName),
                },
                { value: "global", label: scopeLabel(null, "") },
              ]}
              onValueChange={(picked) =>
                set("workspace", picked === "here" ? here : undefined)
              }
            />
          ) : (
            <Input
              value={scopeLabel(scope, props.workspaceName, lophn)}
              readOnly
            />
          )}
        </Field>
        <Issues issues={issues("workspace")} />
      </div>

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

      <Group name="modality" heading={t("agents.heading.modality")}>
        <ModalityToggles
          definition={definition}
          onChange={(modality) => set("modality", modality)}
        />
        <p className={styles.note}>{t("agents.notice.modality-help")}</p>
        <Issues issues={issues("modality")} />
      </Group>

      {detail.card === undefined ? null : (
        <Group name="card" heading={t("agents.heading.card")}>
          <CardFacts card={detail.card} workspaceName={props.workspaceName} />
          <p className={styles.note}>{t("agents.notice.card-help")}</p>
        </Group>
      )}

      <Group name="skip" heading={t("agents.heading.skip")}>
        <Checkbox
          size="sm"
          label={t("agents.label.skip-start")}
          checked={definition.skip === true}
          onCheckedChange={(on) => set("skip", on ? true : undefined)}
        />
        <p className={styles.note}>{t("agents.notice.skip-help")}</p>
        <Issues issues={issues("skip")} />
      </Group>

      <p className={styles.note}>
        {fresh ? `${t("agents.notice.grants-after-create")} ` : ""}
        {t("agents.notice.stored-in-lophn")}
      </p>
      {!fresh && !lophn && !coding ? (
        <DeleteAgent name={name} onDelete={props.onDelete} />
      ) : null}
    </div>
  );
}
