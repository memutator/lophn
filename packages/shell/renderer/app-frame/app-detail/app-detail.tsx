// app-detail: 한 앱의 이름·보관(General), 실행 허용(Run)과 Version·Access·Activity를 보고 이전 release로 돌아가기,
// 바깥 자원 거두기, 앱 data rewind를 한다. 앱 workspace의 App details 탭 본문이다. 사람은
// release를 고르거나 쓰기 시작하지 않는다. 결정은 확인 창 없이 이 탭에서 바로 한다.
import { type FormEvent, useState } from "react";
import { Field, Input } from "@lophn/ui/input";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { actionIcons, commonIcons } from "../../icons/mod.ts";
import { AccessTab } from "./access/access-tab.tsx";
import { ActivityTab } from "./activity/activity-tab.tsx";
import { FoldersSection } from "./folders-section.tsx";
import { IconSection } from "./icon-section.tsx";
import { MachinesSection } from "./machines-section.tsx";
import { RunSection } from "./run-section.tsx";
import type { AppDetailSource } from "./source.ts";
import { VersionsTab } from "./versions/versions-tab.tsx";
import styles from "./app-detail.module.css";
import sectionStyles from "./app-section.module.css";

interface AppDetailProps {
  app: string;
  /** 사람이 지은 앱 이름. */
  name: string;
  source: AppDetailSource;
  /** 호출 기록의 agent session을 연다. 없으면 session 이름만 보인다. */
  onOpenSession?: (session: string) => void;
  /** 이름을 바꿨다. 창의 crumb과 탭 제목이 새 이름을 쓴다. */
  onRenamed?: (name: string) => void;
  /** 보관했다. 들어와 있는 앱 workspace를 떠난다. */
  onArchived?: () => void;
  now?: () => Date;
}

// 이름 바꾸기와 보관. 보관은 Home의 Workspaces panel에서 되살리므로 확인 없이 한다.
function GeneralSection({
  app,
  name,
  source,
  onRenamed,
  onArchived,
}: {
  app: string;
  name: string;
  source: AppDetailSource;
  onRenamed?: (name: string) => void;
  onArchived?: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(name);
  const [failed, setFailed] = useState<"rename" | "archive" | null>(null);
  const trimmed = draft.trim();

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === "" || trimmed === saved) return;
    const reply = await source.rename(app, trimmed);
    setFailed(reply.ok ? null : "rename");
    if (!reply.ok) return;
    setSaved(trimmed);
    setDraft(trimmed);
    onRenamed?.(trimmed);
  };

  const archive = async () => {
    const reply = await source.archive(app);
    setFailed(reply.ok ? null : "archive");
    if (reply.ok) onArchived?.();
  };

  return (
    <section
      className={sectionStyles.section}
      aria-label={t("app-detail.heading.general")}
      data-app-general=""
    >
      <div className={sectionStyles.head}>
        <h4 className={sectionStyles.label}>
          {t("app-detail.heading.general")}
        </h4>
      </div>
      <form
        className={sectionStyles.row}
        onSubmit={(event) => void rename(event)}
      >
        <span className={sectionStyles.text}>
          <Field label={t("app-detail.label.name")}>
            <Input
              data-app-name-input=""
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </Field>
        </span>
        <span className={sectionStyles.action}>
          <Button
            size="sm"
            type="submit"
            icon={actionIcons.save}
            disabled={trimmed === "" || trimmed === saved}
          >
            {t("app-detail.button.save-name")}
          </Button>
        </span>
      </form>
      <div className={sectionStyles.row}>
        <span className={sectionStyles.stack}>
          <span className={sectionStyles.state}>
            {t("app-detail.heading.archive")}
          </span>
          <span className={sectionStyles.note}>
            {t("app-detail.note.archive")}
          </span>
        </span>
        <span className={sectionStyles.action}>
          <Button
            size="sm"
            icon={commonIcons.archive}
            data-app-archive=""
            onClick={() => void archive()}
          >
            {t("app-detail.button.archive")}
          </Button>
        </span>
      </div>
      {failed === null ? null : (
        <p className={sectionStyles.failed}>
          {t(
            failed === "rename"
              ? "app-detail.error.rename-failed"
              : "app-detail.error.archive-failed",
          )}
        </p>
      )}
    </section>
  );
}

const systemNow = () => new Date();

export function AppDetail({
  app,
  name,
  source,
  onOpenSession,
  onRenamed,
  onArchived,
  now = systemNow,
}: AppDetailProps) {
  return (
    <div className={styles.root} data-app-detail={app}>
      <div className={styles.top}>
        <h3 className={styles.name} data-app-detail-name="">
          {name}
        </h3>
      </div>
      <GeneralSection
        // 창이 앱 이름을 읽어 오면 초안을 그 값에서 다시 시작한다.
        key={name}
        app={app}
        name={name}
        source={source}
        onRenamed={onRenamed}
        onArchived={onArchived}
      />
      <IconSection app={app} name={name} source={source} />
      <RunSection app={app} source={source} now={now} />
      <FoldersSection app={app} source={source} />
      <MachinesSection app={app} now={now} />
      <Tabs defaultValue="version">
        <TabList>
          <Tab value="version" size="sm">
            {t("app-detail.label.tab-version")}
          </Tab>
          <Tab value="access" size="sm">
            {t("app-detail.label.tab-access")}
          </Tab>
          <Tab value="activity" size="sm">
            {t("app-detail.label.tab-activity")}
          </Tab>
        </TabList>
        <TabPanel value="version">
          <VersionsTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="access">
          <AccessTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab
            app={app}
            name={name}
            source={source}
            now={now}
            onOpenSession={onOpenSession}
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}
