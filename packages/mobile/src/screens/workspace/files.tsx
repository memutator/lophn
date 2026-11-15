// The Files tab of a project and the reader (tools/wireframes/drafts/phone/workspace.tsx Files, Reader). Read only: a
// folder is browsed, a text file is read, and to change one the person asks the agent from the box at the bottom.
import { t } from "@lophn/i18n";
import {
  Banner,
  CodeBlock,
  Icon,
  Markdown,
  Row,
  Screen,
  Text,
  TopBar,
  useTheme,
} from "@lophn/ui-native";
import {
  ChevronRight,
  FileText,
  Folder,
  Info,
  Monitor,
} from "lucide-react-native";
import { Fragment } from "react";
import { Pressable, View } from "react-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useNames, type Workspace } from "../../data/mod.ts";
import {
  type ProjectFileEntry,
  useProjectFile,
  useProjectFiles,
} from "../../data/mod.ts";
import { ago, EmptyNote, OfflineBanner } from "../../parts/mod.ts";
import { AskBar, Failed } from "./common.tsx";

const join = (folder: string, name: string) =>
  folder === "" ? name : `${folder}/${name}`;

/** Where in the project a path is, as the names above it: `docs/reports` → ["docs", "reports"]. */
const parts = (path: string) => (path === "" ? [] : path.split("/"));

function Crumbs({
  project,
  path,
  onOpen,
}: {
  project: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  const theme = useTheme();
  const folders = parts(path);
  const names = [project, ...folders];
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        paddingTop: 12,
        paddingBottom: 4,
        paddingHorizontal: 20,
      }}
    >
      {names.map((name, at) => (
        <Fragment key={at}>
          {at > 0 && <Icon icon={ChevronRight} size={13} tone="muted" />}
          <Pressable
            disabled={at === names.length - 1}
            onPress={() => onOpen(folders.slice(0, at).join("/"))}
            hitSlop={8}
          >
            <Text
              variant="small"
              style={{
                color:
                  at === names.length - 1
                    ? theme.color.text.primary
                    : theme.color.text.muted,
              }}
            >
              {name}
            </Text>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

export function FilesTab({
  project,
  name,
  path,
  onPath,
}: {
  project: string;
  /** The project's name, the first crumb. */
  name: string;
  path: string;
  onPath: (path: string) => void;
}) {
  const nav = useNav();
  const files = useProjectFiles(project, path);
  const open = (entry: ProjectFileEntry) =>
    entry.kind === "folder"
      ? onPath(join(path, entry.name))
      : nav.open({ name: "file", project, path: join(path, entry.name) });
  return (
    <>
      <Crumbs project={name} path={path} onOpen={onPath} />
      {files.loaded.state === "failed" && <Failed onRetry={files.reload} />}
      {files.loaded.state === "ready" &&
        (files.loaded.value.length === 0 ? (
          <EmptyNote>{t("mobile.places.files.empty")}</EmptyNote>
        ) : (
          files.loaded.value.map((entry) => (
            <Row
              key={entry.name}
              lead={<Icon icon={entry.kind === "folder" ? Folder : FileText} />}
              title={entry.name}
              sub={ago(entry.modified_at)}
              end={
                entry.kind === "folder" ? (
                  <Icon icon={ChevronRight} size={16} />
                ) : undefined
              }
              onPress={() => open(entry)}
            />
          ))
        ))}
    </>
  );
}

// ---- the reader

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

// A phone does not draw a megabyte of text; the core already cuts at 1 MiB.
const SHOWN_CHARS = 100_000;

export function FileScreen({ place }: { place: PlaceOf<"file"> }) {
  const nav = useNav();
  const file = useProjectFile(place.project, place.path);
  const projectName = useNames().projects.get(place.project) ?? place.project;
  const folders = parts(place.path);
  const name = folders.pop() ?? place.path;
  const workspace = { kind: "project", id: place.project } as Workspace;
  const read = file.loaded.state === "ready" ? file.loaded.value : null;
  return (
    <Screen
      top={
        <TopBar
          left="back"
          onLeft={nav.back}
          title={name}
          under={[projectName, ...folders].join(" / ")}
        />
      }
      scroll
      footer={
        <AskBar
          workspace={workspace}
          placeholder={t("mobile.places.composer.file")}
          wrap={(text) =>
            t("mobile.places.file.about", { path: place.path, text })
          }
        />
      }
    >
      <OfflineBanner note={t("mobile.offline.note")} />
      {file.loaded.state === "failed" && <Failed onRetry={file.reload} />}
      {read?.kind === "not-text" && (
        <View style={{ alignItems: "center", gap: 12, padding: 32 }}>
          <Icon icon={Monitor} size={28} tone="muted" />
          <Text tone="muted" align="center">
            {t("mobile.places.files.not-text")}
          </Text>
        </View>
      )}
      {read?.kind === "text" && (
        <>
          {(read.truncated || read.text.length > SHOWN_CHARS) && (
            <Banner icon={Info} title={t("mobile.places.files.truncated")} />
          )}
          <View style={{ paddingTop: 8, paddingHorizontal: 20 }}>
            {isMarkdown(place.path) ? (
              <Markdown source={read.text.slice(0, SHOWN_CHARS)} />
            ) : (
              <CodeBlock
                code={read.text.slice(0, SHOWN_CHARS)}
                language={place.path.split(".").at(-1)}
              />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
