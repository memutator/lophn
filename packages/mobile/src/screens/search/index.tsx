// Search (tools/wireframes/drafts/phone/shell.tsx SearchScreen): one box over sessions, workflows, files, jobs and agents.
// A kind with nothing found is not drawn.
import { t } from "@lophn/i18n";
import {
  Dot,
  Icon,
  IconButton,
  Input,
  Label,
  Row,
  Screen,
  Text,
  useTheme,
} from "@lophn/ui-native";
import {
  ArrowLeft,
  Clock,
  FileText,
  type LucideIcon,
  Search as SearchIcon,
  Workflow,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { type WorkflowHit, useSearch } from "../../data/mod.ts";
import { Face, LOPHN, OfflineBanner, SessionDot } from "../../parts/mod.ts";

const WORKFLOW_STATE = {
  human: "workflow.label.state-human",
  running: "workflow.label.state-running",
  ended: "workflow.label.state-ended",
  stopped: "workflow.label.state-stopped",
} as const satisfies Record<WorkflowHit["state"], string>;

function Mark({ icon }: { icon: LucideIcon }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon icon={icon} color={theme.color.text.primary} />
    </View>
  );
}

export function SearchScreen(_: { place: PlaceOf<"search"> }) {
  const nav = useNav();
  const [query, setQuery] = useState("");
  const found = useSearch(query);
  const none =
    query.trim() !== "" &&
    found.sessions.length +
      found.workflows.length +
      found.files.length +
      found.jobs.length +
      found.agents.length ===
      0;
  return (
    <Screen
      top={
        <View
          style={{
            height: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            paddingHorizontal: 8,
          }}
        >
          <IconButton
            icon={ArrowLeft}
            label={t("common.button.back")}
            size={24}
            onPress={nav.back}
          />
          <View style={{ flex: 1, marginRight: 8 }}>
            <Input
              soft
              compact
              autoFocus
              icon={SearchIcon}
              value={query}
              onChangeText={setQuery}
              placeholder={t("left-sidebar.button.quick-search")}
            />
          </View>
        </View>
      }
      scroll
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      {found.sessions.length > 0 && (
        <>
          <Label>{t("mobile.frame.label.sessions")}</Label>
          {found.sessions.map(({ row, workspaceName }) => (
            <Row
              key={row.id}
              lead={<Face profile={row.who?.profile ?? LOPHN} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              sub={[row.who?.name, workspaceName]
                .filter((part) => part !== undefined)
                .join(" · ")}
              end={<SessionDot status={row.status} />}
              onPress={() =>
                nav.open({
                  name: "session",
                  session: row.id,
                  agent: row.agent ?? lophnIdOf(row.workspace),
                  workspace: row.workspace,
                })
              }
            />
          ))}
        </>
      )}
      {found.workflows.length > 0 && (
        <>
          <Label>{t("workflow.heading.list")}</Label>
          {found.workflows.map((hit) => (
            <Row
              key={hit.run}
              lead={<Mark icon={Workflow} />}
              title={hit.workflow}
              sub={`${hit.projectName} · ${t(WORKFLOW_STATE[hit.state])}`}
              end={
                hit.state === "human" ? (
                  <Dot tone="warning" />
                ) : hit.state === "running" ? (
                  <Dot tone="working" />
                ) : undefined
              }
              onPress={() =>
                nav.open({
                  name: "workflow-run",
                  project: hit.project,
                  run: hit.run,
                })
              }
            />
          ))}
        </>
      )}
      {found.files.length > 0 && (
        <>
          <Label>{t("common.heading.palette-files")}</Label>
          {found.files.map((hit) => (
            <Row
              key={`${hit.project}\0${hit.folder}\0${hit.path}`}
              lead={<Mark icon={FileText} />}
              title={hit.name}
              sub={[hit.projectName, hit.folders]
                .filter((part) => part !== "")
                .join(" / ")}
              onPress={() =>
                nav.open({ name: "file", project: hit.project, path: hit.path, folder: hit.folder })
              }
            />
          ))}
        </>
      )}
      {found.jobs.length > 0 && (
        <>
          <Label>{t("left-sidebar.button.jobs")}</Label>
          {found.jobs.map((hit) => (
            <Row
              key={hit.id}
              lead={<Mark icon={Clock} />}
              title={hit.title}
              sub={hit.when}
              onPress={() => nav.open({ name: "job", id: hit.id })}
            />
          ))}
        </>
      )}
      {found.agents.length > 0 && (
        <>
          <Label>{t("left-sidebar.button.agents")}</Label>
          {found.agents.map((hit) => (
            <Row
              key={hit.id}
              lead={<Face profile={hit.who.profile} />}
              title={hit.name}
              sub={hit.sub}
              onPress={() => nav.open({ name: "agent", id: hit.id })}
            />
          ))}
        </>
      )}
      {none && (
        <View style={{ padding: 20 }}>
          <Text tone="muted">{t("file-search.notice.no-matches")}</Text>
        </View>
      )}
    </Screen>
  );
}
