import {
  AgentMessage,
  ApprovalCard,
  Badge,
  Button,
  Card,
  Checkbox,
  CodeBlock,
  Composer,
  EditCard,
  EmptyState,
  ErrorState,
  Field,
  Fold,
  IconButton,
  Input,
  List,
  ListItem,
  Loading,
  Markdown,
  Menu,
  MessageList,
  QuestionCard,
  type Scheme,
  Screen,
  SegmentedControl,
  Sheet,
  Stack,
  StatusDot,
  StatusMark,
  Switch,
  TabBar,
  Text,
  ThemeProvider,
  ThreadNote,
  ToolLine,
  UserMessage,
  WorkingRow,
} from "@lophn/ui-native";
import {
  Ellipsis,
  FileText,
  Inbox,
  MessagesSquare,
  Plus,
  Search,
  Terminal,
  Trash2,
} from "lucide-react-native";
import { type ReactElement, useEffect, useState } from "react";
import { BackHandler, ScrollView } from "react-native";
import { ANSWER, SESSIONS, STREAM, type SampleSession } from "./sample.ts";

type Route =
  | { name: "home" }
  | { name: "chat"; session: SampleSession }
  | { name: "components" };

const TONE = {
  "needs-you": "warning",
  working: "good",
  idle: "neutral",
  failed: "critical",
} as const;

// The kit drawn with made-up data: what the phone screens will look like, and every component on one page.
export function Gallery({ onExit }: { onExit: () => void }) {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [scheme, setScheme] = useState<Scheme>();
  const home = () => setRoute({ name: "home" });

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.name === "home") return false;
      setRoute({ name: "home" });
      return true;
    });
    return () => back.remove();
  }, [route.name]);

  return (
    <ThemeProvider scheme={scheme}>
      {route.name === "home" && (
        <Home
          scheme={scheme}
          onScheme={setScheme}
          onOpen={(session) => setRoute({ name: "chat", session })}
          onComponents={() => setRoute({ name: "components" })}
          onExit={onExit}
        />
      )}
      {route.name === "chat" && <Chat session={route.session} onBack={home} />}
      {route.name === "components" && <Components onBack={home} />}
    </ThemeProvider>
  );
}

function SessionRow({
  session,
  onOpen,
}: {
  session: SampleSession;
  onOpen: (session: SampleSession) => void;
}) {
  return (
    <ListItem
      title={session.title}
      meta={`${session.status}\n${session.project} · ${session.agent}`}
      metaLines={2}
      leading={
        <StatusDot
          tone={TONE[session.state]}
          pulse={session.state === "working"}
        />
      }
      trailing={
        <Text variant="caption" tone="muted">
          {session.time}
        </Text>
      }
      onPress={() => onOpen(session)}
    />
  );
}

function Home({
  scheme,
  onScheme,
  onOpen,
  onComponents,
  onExit,
}: {
  scheme: Scheme | undefined;
  onScheme: (scheme: Scheme | undefined) => void;
  onOpen: (session: SampleSession) => void;
  onComponents: () => void;
  onExit: () => void;
}) {
  const [tab, setTab] = useState<"sessions" | "inbox">("sessions");
  const [menu, setMenu] = useState(false);
  const [waiting, setWaiting] = useState(["s1", "s2"]);
  const group = (state: SampleSession["state"][]) =>
    SESSIONS.filter((session) => state.includes(session.state));
  const settle = (id: string) =>
    setWaiting(waiting.filter((item) => item !== id));
  return (
    <Screen
      title={tab === "sessions" ? "Sessions" : "Inbox"}
      subtitle="desk-linux · Connected"
      actions={
        <>
          {tab === "sessions" && (
            <IconButton icon={Plus} label="New session" onPress={() => {}} />
          )}
          <IconButton icon={Ellipsis} label="More" onPress={() => setMenu(true)} />
        </>
      }
      footer={
        <TabBar
          value={tab}
          onChange={setTab}
          items={[
            { value: "sessions", label: "Sessions", icon: MessagesSquare },
            {
              value: "inbox",
              label: "Inbox",
              icon: Inbox,
              badge: waiting.length,
            },
          ]}
        />
      }
    >
      <ScrollView>
        {tab === "sessions" ? (
          <Stack gap={8} padding={6}>
            <List title="Needs you">
              {group(["needs-you"]).map((session) => (
                <SessionRow key={session.id} session={session} onOpen={onOpen} />
              ))}
            </List>
            <List title="Working">
              {group(["working"]).map((session) => (
                <SessionRow key={session.id} session={session} onOpen={onOpen} />
              ))}
            </List>
            <List title="Recent">
              {group(["idle", "failed"]).map((session) => (
                <SessionRow key={session.id} session={session} onOpen={onOpen} />
              ))}
            </List>
          </Stack>
        ) : waiting.length === 0 ? (
          <Stack padding={12}>
            <EmptyState
              icon={Inbox}
              title="Nothing is waiting on you"
              body="Approvals and questions from your agents show up here."
            />
          </Stack>
        ) : (
          <Stack gap={6} padding={6}>
            {waiting.includes("s1") && (
              <ApprovalCard
                icon={Terminal}
                title="Run a command"
                meta="Relay reconnect after sleep · lophn"
                subject="fly deploy . --config packages/relay/fly.toml --dockerfile packages/relay/Dockerfile"
                detail="Deploys the relay to Fly.io. It reaches the network."
                choices={[
                  { id: "once", label: "Allow once", kind: "allow" },
                  { id: "session", label: "Allow for this session", kind: "other" },
                  { id: "deny", label: "Deny", kind: "deny" },
                ]}
                onDecide={() => settle("s1")}
              />
            )}
            {waiting.includes("s2") && (
              <QuestionCard
                questions={[
                  {
                    id: "q1",
                    text: "Which day should the week start on?",
                    options: [
                      { label: "Monday", description: "ISO week" },
                      { label: "Sunday" },
                    ],
                  },
                  {
                    id: "q2",
                    text: "Which views do you want?",
                    multi: true,
                    options: [
                      { label: "Day" },
                      { label: "Week" },
                      { label: "Month" },
                    ],
                  },
                ]}
                onSubmit={() => settle("s2")}
              />
            )}
          </Stack>
        )}
      </ScrollView>
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        title="Gallery"
        items={[
          { label: "All components", onSelect: onComponents },
          {
            label: "Follow system theme",
            selected: scheme === undefined,
            onSelect: () => onScheme(undefined),
          },
          {
            label: "Light",
            selected: scheme === "light",
            onSelect: () => onScheme("light"),
          },
          {
            label: "Dark",
            selected: scheme === "dark",
            onSelect: () => onScheme("dark"),
          },
          { label: "Leave gallery", danger: true, onSelect: onExit },
        ]}
      />
    </Screen>
  );
}

type Entry =
  | { id: string; kind: "user"; text: string; note?: string }
  | { id: string; kind: "agent"; source: string }
  | { id: string; kind: "work" }
  | { id: string; kind: "note"; text: string };

const THREAD: Entry[] = [
  {
    id: "1",
    kind: "user",
    text: "The phone does not come back after the laptop sleeps. Can you look?",
  },
  { id: "2", kind: "work" },
  { id: "3", kind: "agent", source: ANSWER },
  { id: "4", kind: "note", text: "Context compacted" },
  { id: "5", kind: "user", text: "Good. Run the restart test too." },
];

function Chat({
  session,
  onBack,
}: {
  session: SampleSession;
  onBack: () => void;
}) {
  const [thread, setThread] = useState(THREAD);
  const [draft, setDraft] = useState("");
  const [output, setOutput] = useState(false);
  const [menu, setMenu] = useState(false);
  const [working, setWorking] = useState(session.state !== "idle");
  const [asking, setAsking] = useState(session.state === "needs-you");
  // Text arrives a few characters at a time, the way a model writes.
  const [written, setWritten] = useState(0);
  useEffect(() => {
    if (!working || written >= STREAM.length) return;
    const timer = setTimeout(() => setWritten(written + 3), 40);
    return () => clearTimeout(timer);
  }, [working, written]);

  const render = (entry: Entry): ReactElement => {
    switch (entry.kind) {
      case "user":
        return <UserMessage text={entry.text} note={entry.note} />;
      case "agent":
        return <AgentMessage source={entry.source} />;
      case "note":
        return <ThreadNote text={entry.text} />;
      default:
        return (
          <Fold label="Worked for 1m 12s">
            <ToolLine
              icon={Search}
              title="Searched"
              detail="openFirst"
              state="done"
              onPress={() => setOutput(true)}
            />
            <ToolLine
              icon={FileText}
              title="Read 3 files"
              state="done"
              onPress={() => setOutput(true)}
            />
            <Stack gap={4} paddingY={2}>
              <EditCard
                path="mobile/src/connection/connection.ts"
                added={18}
                removed={4}
                state="done"
                onPress={() => setOutput(true)}
              />
            </Stack>
            <ToolLine
              icon={Terminal}
              title="Ran"
              detail="npm test"
              state="failed"
              onPress={() => setOutput(true)}
            />
          </Fold>
        );
    }
  };

  return (
    <Screen
      title={session.title}
      subtitle={`${session.agent} · ${session.project}`}
      onBack={onBack}
      actions={
        <IconButton icon={Ellipsis} label="More" onPress={() => setMenu(true)} />
      }
      footer={
        <Composer
          value={draft}
          onChangeText={setDraft}
          working={working}
          onStop={() => setWorking(false)}
          onAttach={() => {}}
          onSend={() => {
            setThread([
              ...thread,
              {
                id: String(thread.length + 1),
                kind: "user",
                text: draft.trim(),
                note: working ? "Queued" : undefined,
              },
            ]);
            setDraft("");
          }}
        />
      }
    >
      <MessageList
        items={thread}
        keyOf={(entry) => entry.id}
        renderItem={render}
        tail={
          working ? (
            <>
              <ToolLine
                icon={Terminal}
                title="Running"
                detail="npm test -- restart"
                state="running"
              />
              <AgentMessage source={STREAM.slice(0, written)} streaming />
              {asking ? (
                <ApprovalCard
                  icon={Terminal}
                  title="Run a command"
                  subject="rm -rf .dev-data/ledger && npm run dev:core"
                  detail="Deletes the development data folder."
                  choices={[
                    { id: "once", label: "Allow once", kind: "allow" },
                    {
                      id: "session",
                      label: "Allow for this session",
                      kind: "other",
                    },
                    { id: "deny", label: "Deny", kind: "deny" },
                  ]}
                  onDecide={() => setAsking(false)}
                />
              ) : (
                <WorkingRow label="Working" />
              )}
            </>
          ) : undefined
        }
      />
      <Sheet open={output} onClose={() => setOutput(false)} title="npm test">
        <Stack gap={5} paddingY={4}>
          <StatusMark tone="critical" label="Exit code 1" />
          <CodeBlock
            language="sh"
            code={`> lophn-mobile test\n> node --test "src/**/*.test.ts"\n\n✔ races direct and relay (12ms)\n✖ resumes after pause (3004ms)\n  AssertionError: expected "connected", got "connecting"\n\ntests 14  pass 13  fail 1`}
          />
        </Stack>
      </Sheet>
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        items={[
          { label: "Rename", onSelect: () => {} },
          { label: "Start working again", onSelect: () => setWorking(true) },
          { label: "Delete session", icon: Trash2, danger: true, onSelect: onBack },
        ]}
      />
    </Screen>
  );
}

function Components({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState("");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [sheet, setSheet] = useState(false);
  return (
    <Screen title="Components" onBack={onBack} scroll>
      <Stack gap={8} padding={6}>
        <Stack gap={2}>
          <Text variant="display">Display 28</Text>
          <Text variant="title">Title 20</Text>
          <Text variant="titleSmall">Title small 16</Text>
          <Text>Body 16. The quick brown fox. 다람쥐 헌 쳇바퀴에 타고파.</Text>
          <Text variant="small" tone="secondary">
            Small 14, secondary
          </Text>
          <Text variant="caption" tone="muted">
            Caption 13, muted
          </Text>
          <Text mono variant="small">
            mono: const x = 1;
          </Text>
        </Stack>

        <Stack gap={4}>
          <Button variant="primary" block onPress={() => {}}>
            Primary, block
          </Button>
          <Stack direction="row" gap={4} wrap align="center">
            <Button onPress={() => {}}>Secondary</Button>
            <Button variant="ghost" onPress={() => {}}>
              Ghost
            </Button>
            <Button variant="danger" icon={Trash2} onPress={() => {}}>
              Delete
            </Button>
          </Stack>
          <Stack direction="row" gap={4} wrap align="center">
            <Button size="sm" onPress={() => {}}>
              Small
            </Button>
            <Button size="lg" onPress={() => {}}>
              Large
            </Button>
            <Button busy onPress={() => {}}>
              Busy
            </Button>
            <Button disabled onPress={() => {}}>
              Disabled
            </Button>
          </Stack>
        </Stack>

        <Stack gap={6}>
          <Field label="Name" help="Shown in the session list.">
            <Input value={text} onChangeText={setText} placeholder="Untitled" />
          </Field>
          <Field label="Address" error="This address is not reachable.">
            <Input value="ws://10.0.0.9:7431" onChangeText={() => {}} />
          </Field>
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
          <Checkbox checked={checked} onChange={setChecked} label="Checkbox" />
          <Checkbox
            shape="round"
            checked={!checked}
            onChange={(next) => setChecked(!next)}
            label="Radio"
            description="One of several"
          />
        </Stack>

        <List title="List">
          <ListItem
            title="Notifications"
            trailing={<Switch value={on} onChange={setOn} label="Notifications" />}
          />
          <ListItem title="Computers" meta="2 paired" chevron onPress={() => {}} />
          <ListItem
            title="Waiting"
            trailing={<Badge count={3} />}
            chevron
            onPress={() => {}}
          />
        </List>

        <Stack gap={4}>
          <StatusMark tone="good" label="Connected" />
          <StatusMark tone="warning" label="Needs you" />
          <StatusMark tone="serious" label="Slow" />
          <StatusMark tone="critical" label="Failed" />
          <StatusMark tone="neutral" label="Idle" />
        </Stack>

        <Card>
          <Stack gap={4}>
            <Text weight="semibold">Card</Text>
            <Text variant="small" tone="secondary">
              A surface for one thing.
            </Text>
            <Button onPress={() => setSheet(true)}>Open a sheet</Button>
          </Stack>
        </Card>

        <Card padding={0}>
          <Stack paddingY={8}>
            <Loading label="Loading sessions" />
          </Stack>
        </Card>
        <Card padding={0}>
          <ErrorState
            title="Could not reach desk-linux"
            body="It may be asleep or off."
            onRetry={() => {}}
          />
        </Card>

        <Markdown source={ANSWER} />
      </Stack>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Sheet">
        <Stack gap={5} paddingY={4}>
          <Text tone="secondary">
            Drag the handle down, press outside, or use the back button to close.
          </Text>
          <Button variant="primary" block onPress={() => setSheet(false)}>
            Done
          </Button>
        </Stack>
      </Sheet>
    </Screen>
  );
}
