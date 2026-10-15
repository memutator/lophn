// 대기 목록. 창 위 pill과 그것을 펼친 panel, 요청 카드다. 모든 session의 대기 요청이 한 목록에 있고 종류를 나눠
// 보인다. 카드 문구는 program이 만든 것이라 요청한 agent가 쓴 설명은 없다. 목록에서 바로 답한다.
import { type ReactNode, useState } from "react";

import {
  Avatar,
  Button,
  DiffMark,
  Field,
  IconButton,
  StatusMark,
  Textarea,
  ToastStack,
} from "@lophn/design/components";

import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { VendorIcon } from "../../vendors/vendor-icon.tsx";

import type {
  ActivationItem,
  CodingItem,
  PermissionItem,
  QuestionItem,
  ReactionItem,
  Requester,
  SettledRow,
  ToastRow,
  WaitingItem,
} from "./waiting-data.ts";
import { WaitingToast } from "./waiting-toast.tsx";
import styles from "./waiting.module.css";

/** 창 위 pill. 개수는 모든 session의 대기 요청을 합한 것이다. */
function WaitingPill(
  { count, open, onClick }: {
    count: number;
    open: boolean;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      className={styles.pill}
      aria-expanded={open}
      onClick={onClick}
    >
      {count} waiting
    </button>
  );
}

// 카드 머리: 제목, 한 줄 설명, 누구(agent)가 어느 session에서 어느 앱·project에 대해 청했는지.
// 세부가 있으면 오른쪽 끝에 펼침 토글이 있다. 토글 위치는 카드마다 같다.
function Head(
  { from, title, description, session = true, toggle }: {
    from: Requester;
    title: string;
    description: string;
    session?: boolean;
    toggle?: { open: boolean; onToggle: () => void };
  },
) {
  const meta = [from.agent, session ? from.session : "", from.scope]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div className={styles.who}>
      <span className={styles.face}>
        {from.vendor === undefined
          ? <Avatar profile={from.profile} size="sm" />
          : <VendorIcon vendor={from.vendor} size={20} />}
      </span>
      <div className={styles.whoText}>
        <p className={styles.title}>{title}</p>
        <p className={styles.desc}>{description}</p>
        <span className={styles.meta}>{meta}</span>
      </div>
      <div className={styles.side}>
        <span className={styles.age}>{from.age}</span>
        {toggle === undefined ? <span className={styles.slot} /> : (
          <IconButton
            icon={toggle.open
              ? lophnSpaceIcons.collapse
              : lophnSpaceIcons.expand}
            label={toggle.open ? "Hide details" : "Show details"}
            size="sm"
            aria-expanded={toggle.open}
            onClick={toggle.onToggle}
          />
        )}
      </div>
    </div>
  );
}

// 거절할 때 이유를 적는 칸. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다.
function Reason(
  { agent, value, onChange, onCancel, onDeny }: {
    agent: string;
    value: string;
    onChange: (value: string) => void;
    onCancel: () => void;
    onDeny: () => void;
  },
) {
  return (
    <>
      <div className={styles.reason}>
        <Field
          label="Reason (optional)"
          help={`Sent to ${agent} as the tool result.`}
        >
          <Textarea
            rows={2}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </Field>
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="danger" onClick={onDeny}>Deny</Button>
      </div>
    </>
  );
}

function Effect({ effect }: { effect: PermissionItem["effect"] }) {
  return <span className={styles.effect} data-effect={effect}>{effect}</span>;
}

interface CardProps<Item> {
  readonly item: Item;
  /** 이 요청에 답했다. */
  readonly onDecide: (id: string) => void;
  /** 거절 이유 칸을 연 채 시작한다. */
  readonly denying?: boolean;
  readonly reason?: string;
  /** 세부를 펼친 채 시작한다. 기본은 접힌다. */
  readonly expanded?: boolean;
}

// 거절 단추와 이유 칸을 한 상태로 묶는다. 단추는 모두 오른쪽 끝에 모이고 주 행동이 맨 오른쪽이다.
// 허락 단추는 children으로 받고 Deny가 그 앞에 온다.
function Decision(
  { id, agent, ask, denying, reason, onDecide, children }: {
    id: string;
    agent: string;
    /** 이유 칸을 쓰는 요청인지. 요청한 agent가 없는 reaction은 쓰지 않는다. */
    ask: boolean;
    denying?: boolean;
    reason?: string;
    onDecide: (id: string) => void;
    children: ReactNode;
  },
) {
  const [open, setOpen] = useState(denying ?? false);
  const [text, setText] = useState(reason ?? "");
  if (open) {
    return (
      <Reason
        agent={agent}
        value={text}
        onChange={setText}
        onCancel={() => setOpen(false)}
        onDeny={() => onDecide(id)}
      />
    );
  }
  return (
    <div className={styles.actions}>
      <Button size="sm" onClick={() => ask ? setOpen(true) : onDecide(id)}>
        Deny
      </Button>
      {children}
    </div>
  );
}

function PermissionCard(
  { item, onDecide, denying, reason, expanded = false }: CardProps<
    PermissionItem
  >,
) {
  const [open, setOpen] = useState(expanded);
  const decide = () => onDecide(item.id);
  return (
    <article className={styles.request} data-kind="permission">
      <Head
        from={item.from}
        title={item.action}
        description={item.summary}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open
        ? (
          <dl className={styles.facts}>
            <dt>Target</dt>
            <dd>{item.target}</dd>
            <dt>Input</dt>
            <dd className={styles.code}>{item.input}</dd>
            <dt>Effect</dt>
            <dd>
              <Effect effect={item.effect} />
            </dd>
          </dl>
        )
        : null}
      <Decision
        id={item.id}
        agent={item.from.agent}
        ask
        denying={denying}
        reason={reason}
        onDecide={onDecide}
      >
        {item.choices === "tool"
          ? (
            <>
              <Button size="sm" onClick={decide}>Always allow</Button>
              <Button size="sm" onClick={decide}>Allow for this session</Button>
              <Button size="sm" variant="primary" onClick={decide}>
                Allow once
              </Button>
            </>
          )
          : (
            <Button size="sm" variant="primary" onClick={decide}>
              Allow
            </Button>
          )}
      </Decision>
    </article>
  );
}

// coding agent의 물음. lophn 화면에서 답하지 않고 그 앱 공간의 터미널 탭으로 focus가 간다.
function CodingCard({ item, onDecide }: CardProps<CodingItem>) {
  return (
    <article className={styles.request} data-kind="coding">
      <Head
        from={item.from}
        title="Permission request in the terminal"
        description={`${item.harness} is waiting for your answer in its terminal tab.`}
      />
      <div className={styles.actions}>
        <Button size="sm" variant="primary" onClick={() => onDecide(item.id)}>
          Answer in terminal
        </Button>
      </div>
    </article>
  );
}

function QuestionCard({ item, onDecide }: CardProps<QuestionItem>) {
  return (
    <article className={styles.request} data-kind="question">
      <Head from={item.from} title="Question" description={item.text} />
      <div className={styles.actions}>
        <Button size="sm" variant="ghost">Open session</Button>
        {[...item.options].reverse().map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === item.options[0] ? "primary" : "secondary"}
            onClick={() => onDecide(item.id)}
          >
            {option}
          </Button>
        ))}
      </div>
    </article>
  );
}

// 늘어난 선언 한 줄과 손실 단계 한 줄.
function Declared(
  { label, value, note }: { label: string; value: string; note?: string },
) {
  return (
    <li className={styles.line}>
      <DiffMark kind="add" />
      <span className={styles.lineLabel}>{label}</span>
      <span className={styles.lineValue}>
        <span className={styles.code}>{value}</span>
        {note === undefined
          ? null
          : <span className={styles.lineNote}>{`  (${note})`}</span>}
      </span>
    </li>
  );
}

function ActivationCard(
  { item, onDecide, denying, reason, expanded = false }: CardProps<
    ActivationItem
  >,
) {
  const [open, setOpen] = useState(expanded);
  const first = item.previous === undefined;
  const parts = [
    `${item.added.length} new declarations`,
    ...(item.loss.length > 0 ? [`${item.loss.length} data-loss steps`] : []),
  ];
  return (
    <article className={styles.request} data-kind="activation">
      <Head
        from={item.from}
        title={`Activate ${item.app} ${item.release}`}
        description={first
          ? `First activation, so every declaration is new. ${
            parts.join(" · ")
          }`
          : `Since ${item.previous}: ${parts.join(" · ")}`}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open
        ? (
          <div className={styles.detail}>
            <p className={styles.detailHead}>
              {first
                ? "Declared by this release (nothing was active before)"
                : `New since ${item.previous}`}
            </p>
            <ul className={styles.lines}>
              {item.added.map((line) => (
                <Declared
                  key={`${line.label}:${line.value}`}
                  label={line.label}
                  value={line.value}
                  note={line.note}
                />
              ))}
            </ul>
            {item.loss.length > 0
              ? (
                <>
                  <p className={styles.detailHead}>
                    <StatusMark tone="warning" label="Data loss" />
                  </p>
                  <ul className={styles.lines}>
                    {item.loss.map((step) => (
                      <li key={step.value} className={styles.line}>
                        <span />
                        <span className={styles.lineLabel}>{step.what}</span>
                        <span className={`${styles.lineValue} ${styles.code}`}>
                          {step.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )
              : null}
            <p className={styles.fine}>
              Only added declarations and data-loss steps are shown.
            </p>
          </div>
        )
        : null}
      <Decision
        id={item.id}
        agent={item.from.agent}
        ask
        denying={denying}
        reason={reason}
        onDecide={onDecide}
      >
        <Button size="sm" variant="primary" onClick={() => onDecide(item.id)}>
          Allow
        </Button>
      </Decision>
    </article>
  );
}

// 물음인 reaction. 어떤 domain event로 어떤 agent의 session을 열지 보인다.
function ReactionCard(
  { item, onDecide, expanded = false }: CardProps<ReactionItem>,
) {
  const [open, setOpen] = useState(expanded);
  return (
    <article className={styles.request} data-kind="reaction">
      <Head
        from={item.from}
        title={`Open a session with ${item.opens}?`}
        description={item.event}
        session={false}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open
        ? (
          <dl className={styles.facts}>
            <dt>Event</dt>
            <dd>{item.event}</dd>
            <dt>Detail</dt>
            <dd>{item.detail}</dd>
            <dt>Opens</dt>
            <dd>New session with {item.opens}</dd>
          </dl>
        )
        : null}
      <Decision
        id={item.id}
        agent={item.from.agent}
        ask={false}
        onDecide={onDecide}
      >
        <Button size="sm" variant="primary" onClick={() => onDecide(item.id)}>
          Allow
        </Button>
      </Decision>
    </article>
  );
}

/** 요청 카드 하나. kind에 맞는 카드를 그린다. 세부는 기본으로 접혀 있다. */
export function RequestCard(
  { item, onDecide, denying, reason, expanded }: CardProps<WaitingItem>,
) {
  switch (item.kind) {
    case "permission":
      return (
        <PermissionCard
          item={item}
          onDecide={onDecide}
          denying={denying}
          reason={reason}
          expanded={expanded}
        />
      );
    case "coding":
      return <CodingCard item={item} onDecide={onDecide} />;
    case "question":
      return <QuestionCard item={item} onDecide={onDecide} />;
    case "activation":
      return (
        <ActivationCard
          item={item}
          onDecide={onDecide}
          denying={denying}
          reason={reason}
          expanded={expanded}
        />
      );
    case "reaction":
      return (
        <ReactionCard item={item} onDecide={onDecide} expanded={expanded} />
      );
  }
}

const GROUPS = [
  {
    title: "Permission requests",
    kinds: ["permission", "coding"],
  },
  { title: "Questions", kinds: ["question"] },
  { title: "Approvals", kinds: ["activation", "reaction"] },
] as const;

const SETTLED_MARK: Record<
  SettledRow["state"],
  { tone: "good" | "neutral" | "warning"; label: string }
> = {
  accepted: { tone: "neutral", label: "Allowed, applying" },
  applied: { tone: "good", label: "Allowed, applied" },
  denied: { tone: "warning", label: "Denied" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

/** 방금 결정한 줄. 접수와 적용 성공을 구별하고, 거절과 cancelled를 구별한다. */
function SettledList({ rows }: { rows: readonly SettledRow[] }) {
  return (
    <section className={styles.group} aria-label="Just settled">
      <div className={styles.groupHead}>
        <span>Just settled</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.settled}>
          <p className={styles.title}>{row.title}</p>
          <span className={styles.meta}>{row.who}</span>
          <StatusMark
            tone={SETTLED_MARK[row.state].tone}
            label={SETTLED_MARK[row.state].label}
          />
          <span className={styles.settledNote}>{row.note}</span>
        </div>
      ))}
    </section>
  );
}

export interface WaitingPanelProps {
  readonly items: readonly WaitingItem[];
  readonly onDecide: (id: string) => void;
  /** 거절 이유 칸을 연 채 시작할 요청. */
  readonly denying?: { readonly id: string; readonly reason?: string };
  /** 세부를 펼친 채 시작할 요청. 나머지는 접혀 있다. */
  readonly expanded?: readonly string[];
  readonly settled?: readonly SettledRow[];
}

/** 펼친 대기 목록. 종류를 나눠 한 목록에 보인다. */
function WaitingPanel(
  { items, onDecide, denying, expanded, settled = [] }: WaitingPanelProps,
) {
  return (
    <section className={styles.panel} aria-label="Waiting">
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Waiting</h2>
        <span className={styles.panelSub}>All sessions</span>
      </header>
      <div className={styles.panelBody}>
        {items.length === 0 && settled.length === 0
          ? <p className={styles.empty}>Nothing is waiting for you.</p>
          : null}
        {GROUPS.map((group) => {
          const rows = items.filter((item) =>
            (group.kinds as readonly string[]).includes(item.kind)
          );
          if (rows.length === 0) return null;
          return (
            <section
              key={group.title}
              className={styles.group}
              aria-label={group.title}
            >
              <div className={styles.groupHead}>
                <span>{group.title}</span>
                <span>{rows.length}</span>
              </div>
              {rows.map((item) => (
                <RequestCard
                  key={item.id}
                  item={item}
                  onDecide={onDecide}
                  denying={denying?.id === item.id}
                  reason={denying?.id === item.id ? denying.reason : undefined}
                  expanded={expanded?.includes(item.id) ?? false}
                />
              ))}
            </section>
          );
        })}
        {settled.length > 0 ? <SettledList rows={settled} /> : null}
      </div>
    </section>
  );
}

export interface WaitingLayerProps {
  readonly items: readonly WaitingItem[];
  /** panel을 펼친 채 시작한다. */
  readonly open?: boolean;
  readonly denying?: WaitingPanelProps["denying"];
  readonly expanded?: readonly string[];
  readonly settled?: readonly SettledRow[];
  /** pill의 개수. 주지 않으면 items의 개수다. */
  readonly count?: number;
  /** 창 오른쪽 아래에 쌓인 toast. [Review]는 panel을 펼치고 [Open session]은 그 session으로 간다. */
  readonly toasts?: readonly ToastRow[];
}

/** 창 위쪽 바 안의 pill과 그 아래로 열리는 panel. 답한 요청은 목록에서 빠진다. ProjectApp의 titleExtra로 쓴다. */
export function WaitingLayer(
  {
    items: initial,
    open: start = false,
    denying,
    expanded,
    settled,
    count,
    toasts: initialToasts = [],
  }: WaitingLayerProps,
) {
  const [open, setOpen] = useState(start);
  const [items, setItems] = useState(initial);
  const [toasts, setToasts] = useState(initialToasts);
  const total = count ?? items.length;
  return (
    <div className={styles.layer}>
      {total > 0 || open
        ? (
          <WaitingPill
            count={total}
            open={open}
            onClick={() => setOpen(!open)}
          />
        )
        : null}
      {open
        ? (
          <div className={styles.floating}>
            <WaitingPanel
              items={items}
              denying={denying}
              expanded={expanded}
              settled={settled}
              onDecide={(id) =>
                setItems((now) => now.filter((item) => item.id !== id))}
            />
          </div>
        )
        : null}
      {toasts.length > 0
        ? (
          <ToastStack>
            {toasts.map((toast) => (
              <WaitingToast
                key={toast.id}
                toast={toast}
                onAction={() => {
                  if (toast.goes === "list") setOpen(true);
                  setToasts((now) => now.filter((row) => row.id !== toast.id));
                }}
                onClose={() =>
                  setToasts((now) => now.filter((row) => row.id !== toast.id))}
              />
            ))}
          </ToastStack>
        )
        : null}
    </div>
  );
}
