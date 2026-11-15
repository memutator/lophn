// Made-up data for the kit gallery. Nothing here comes from or goes to a computer.
export interface SampleSession {
  id: string;
  title: string;
  project: string;
  agent: string;
  state: "needs-you" | "working" | "idle" | "failed";
  status: string;
  time: string;
}

export const SESSIONS: SampleSession[] = [
  {
    id: "s1",
    title: "Relay reconnect after sleep",
    project: "lophn",
    agent: "Builder",
    state: "needs-you",
    status: "Wants to run a command",
    time: "now",
  },
  {
    id: "s2",
    title: "Calendar week view",
    project: "calendar",
    agent: "App builder",
    state: "needs-you",
    status: "Asked you a question",
    time: "4m",
  },
  {
    id: "s3",
    title: "Flaky restart test",
    project: "lophn",
    agent: "Claude Code",
    state: "working",
    status: "Running tests · 2m 10s",
    time: "2m",
  },
  {
    id: "s4",
    title: "Release notes for 0.23",
    project: "lophn",
    agent: "Writer",
    state: "idle",
    status: "Done · 6 files changed",
    time: "1h",
  },
  {
    id: "s5",
    title: "Import bank CSV",
    project: "ledger",
    agent: "Builder",
    state: "failed",
    status: "Stopped: provider error",
    time: "3h",
  },
  {
    id: "s6",
    title: "Weekly review",
    project: "notes",
    agent: "Assistant",
    state: "idle",
    status: "Done",
    time: "Yesterday",
  },
];

export const ANSWER = `The reconnect loop gave up after the first failed probe. Two changes fix it:

1. **Probe again after resume.** The phone now waits for the OS to report the network before dialing.
2. Keep the relay socket as a fallback while the direct address is tried.

\`\`\`ts
const first = await openFirst([direct, relay], { timeout: 3000 });
if (first.via === "relay") void upgrade(direct);
\`\`\`

| Path | Before | After |
|---|---|---|
| Same Wi-Fi | 0.4s | 0.4s |
| LTE | fails | 1.1s |

> Sleep longer than 60s still drops the session; that is the relay's idle limit.

See [the relay notes](https://example.com/relay) for the limits.`;

export const STREAM =
  "I ran the suite twice. The restart test passes alone and fails only when the reader starts under load, so I am adding a wait for the";
