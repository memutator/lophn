// A project workspace (tools/wireframes/drafts/phone/workspace.tsx Sessions): the project's line on top, tabs for its
// sessions, workflows, files and jobs, and a box at the bottom that starts a session in it.
import { t } from "@lophn/i18n";
import { Icon, IconButton, Row, Screen, Tabs, TopBar } from "@lophn/ui-native";
import { Clock, FolderOpen, Plus } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import { DIM, EmptyNote, OfflineBanner, useLocked } from "../../parts/mod.ts";
import {
  nextText,
  useProjectJobs,
  whenOf,
  type Workspace,
  type WorkspaceView,
} from "../../data/mod.ts";
import { AskBar, Failed } from "./common.tsx";
import { FilesTab } from "./files.tsx";
import { SessionList } from "./sessions.tsx";
import { WorkflowsTab } from "./workflows.tsx";

const TABS = [
  "mobile.frame.label.sessions",
  "workflow.heading.list",
  "project-workspace.label.sidebar-tab-explorer",
  "jobs.label.sidebar-tab",
] as const;

// Read only: turning a job on or off and running it now come with the Jobs screens.
function JobsTab({ project }: { project: string }) {
  const jobs = useProjectJobs(project);
  if (jobs.loaded.state === "failed") return <Failed onRetry={jobs.reload} />;
  if (jobs.loaded.state !== "ready") return null;
  if (jobs.loaded.value.length === 0) {
    return <EmptyNote>{t("mobile.places.jobs.empty")}</EmptyNote>;
  }
  const now = new Date();
  return (
    <>
      {jobs.loaded.value.map((job) => (
        <Row
          key={job.id}
          lead={<Icon icon={Clock} />}
          title={job.title}
          sub={`${whenOf(job)} · ${nextText(job, now)}`}
        />
      ))}
    </>
  );
}

export function ProjectWorkspace({ view }: { view: WorkspaceView }) {
  const nav = useNav();
  const locked = useLocked();
  const [tab, setTab] = useState(0);
  // The folder the Files tab is in, kept here so leaving a file comes back to it.
  const [folder, setFolder] = useState("");
  const project = view.key;
  const name = view.name ?? project;
  const workspace = view.workspace as Workspace;
  return (
    <Screen
      top={
        <>
          <TopBar
            {...nav.menuButton}
            lead={<Icon icon={FolderOpen} size={22} />}
            title={name}
            right={
              <IconButton
                icon={Plus}
                label={t("left-sidebar.label.new-session")}
                onPress={() => nav.open({ name: "new-session", workspace })}
              />
            }
          />
          <Tabs items={TABS.map((key) => t(key))} on={tab} onChange={setTab} />
        </>
      }
      scroll
      footer={
        tab === 0 ? (
          <AskBar
            workspace={workspace}
            placeholder={t("mobile.places.composer.project", { name })}
          />
        ) : undefined
      }
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      <View style={{ opacity: locked ? DIM : 1 }}>
        {tab === 0 && <SessionList view={view} />}
        {tab === 1 && <WorkflowsTab project={project} />}
        {tab === 2 && (
          <FilesTab
            project={project}
            name={name}
            path={folder}
            onPath={setFolder}
          />
        )}
        {tab === 3 && <JobsTab project={project} />}
      </View>
    </Screen>
  );
}
