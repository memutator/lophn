// Flow 13. The computer's browser pages, seen and used from the phone: the pages an agent opened and the ones the person
// opened from here. A computer without a screen has only these, so signing in to a site on it happens on this screen.
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  EyeOff,
  Globe,
  KeyboardOff,
  RotateCw,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import c from "./coding.module.css";
import {
  Btn,
  Flow,
  Ic,
  IconBtn,
  Keyboard,
  Label,
  Phone,
  Row,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";
import { COMPUTER, Sidebar } from "./shell.tsx";

const GITHUB = {
  title: "Sign in to GitHub",
  url: "https://github.com/login",
  by: "Eval analyst",
};

const PAGES = [
  GITHUB,
  { title: "phroner dev", url: "http://localhost:5173/boards", by: null },
  {
    title: "Fly.io dashboard",
    url: "https://fly.io/dashboard/mina",
    by: "Release helper",
  },
];

// ── list ─────────────────────────────────────────────

function OpenField({ typed }: { typed?: string }) {
  return (
    <div className={s.dock} style={{ padding: "4px 20px 8px" }}>
      <div
        className={s.field}
        data-focus={typed !== undefined || undefined}
        style={{ minHeight: 42 }}
      >
        <Ic icon={Globe} size={18} className={s.muted} />
        <span
          className={s.grow}
          style={
            typed === undefined
              ? { color: "var(--color-text-muted)" }
              : undefined
          }
        >
          {typed ?? "Open a page on mina-desktop"}
          {typed !== undefined && <span className={s.caret} />}
        </span>
      </div>
    </div>
  );
}

function PageList({ open, typed }: { open?: boolean; typed?: string }) {
  return (
    <>
      <TopBar title="Pages" under={COMPUTER} />
      {open && <OpenField typed={typed} />}
      <Label>Open on {COMPUTER}</Label>
      {PAGES.map((page) => (
        <Row
          key={page.url}
          lead={<Ic icon={Globe} size={22} className={s.muted} />}
          title={page.title}
          sub={page.url.replace(/^https?:\/\//, "")}
          end={
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span className={s.note}>{page.by ?? "You"}</span>
              <Ic icon={ChevronRight} size={16} />
            </span>
          }
        />
      ))}
    </>
  );
}

// ── one page ─────────────────────────────────────────

function PageHead({ viewOnly }: { viewOnly?: boolean }) {
  return (
    <TopBar
      left="back"
      title={GITHUB.title}
      under={COMPUTER}
      right={
        viewOnly ? (
          <span className={s.tag} style={{ marginRight: 14 }}>
            View only
          </span>
        ) : undefined
      }
    />
  );
}

// Back, the address and Reload. A phone that may only watch sees the address alone.
function Address({ viewOnly }: { viewOnly?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: viewOnly ? "2px 20px 8px" : "2px 8px 8px",
      }}
    >
      {!viewOnly && <IconBtn icon={ArrowLeft} size={20} />}
      <div
        className={s.field}
        data-soft=""
        style={{
          flex: 1,
          minHeight: 40,
          fontSize: 15,
          color: viewOnly ? "var(--color-text-secondary)" : undefined,
        }}
      >
        <span
          className={s.grow}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {viewOnly ? "github.com/login" : GITHUB.url}
        </span>
      </div>
      {!viewOnly && <IconBtn icon={RotateCw} size={20} />}
    </div>
  );
}

// Who drives the page now, at the right end the one button that changes it.
function Driver({ held }: { held?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 20px 8px",
      }}
    >
      <span className={s.grow} style={{ fontSize: 14, lineHeight: "20px" }}>
        {held ? "You have control" : `${GITHUB.by} is using this page`}
      </span>
      <Btn size="sm">{held ? "Hand back" : "Take control"}</Btn>
    </div>
  );
}

const field: CSSProperties = {
  height: 34,
  border: "1px solid var(--color-border-strong)",
  borderRadius: 6,
  background: "var(--color-surface-base)",
};

// The page's picture as the computer draws it: a sign-in form, scaled to the phone's width.
function Picture({
  dim,
  over,
  typed,
}: {
  dim?: boolean;
  over?: ReactNode;
  typed?: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 0 6px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "390 / 470",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "26px 34px 0",
          boxSizing: "border-box",
          borderTop: "1px solid var(--color-border-base)",
          borderBottom: "1px solid var(--color-border-base)",
          background: "var(--color-surface-muted)",
          color: "var(--color-text-primary)",
          opacity: dim ? 0.45 : 1,
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: "var(--color-text-primary)",
          }}
        />
        <span style={{ fontSize: 20, fontWeight: 300 }}>Sign in to GitHub</span>
        <div
          style={{
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 16,
            border: "1px solid var(--color-border-base)",
            borderRadius: 6,
            background: "var(--color-surface-base)",
            fontSize: 13,
          }}
        >
          <span>Username or email address</span>
          <span
            style={{
              ...field,
              display: "flex",
              alignItems: "center",
              padding: "0 8px",
              borderColor:
                typed === undefined
                  ? "var(--color-border-strong)"
                  : "var(--color-focus)",
            }}
          >
            {typed}
            {typed !== undefined && <span className={s.caret} />}
          </span>
          <span style={{ marginTop: 6 }}>Password</span>
          <span style={field} />
          <span
            style={{
              ...field,
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "var(--status-good-text)",
              color: "var(--color-surface-base)",
              fontWeight: 600,
            }}
          >
            Sign in
          </span>
        </div>
      </div>
      {over}
    </div>
  );
}

function Waiting({ children }: { children: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
      }}
    >
      <span className={s.note}>{children}</span>
    </div>
  );
}

// Over the last picture while the computer does not draw the page.
function NotPainting() {
  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        right: 24,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 12,
        background: "var(--color-surface-base)",
        boxShadow: "var(--shadow-popover)",
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <Ic icon={EyeOff} size={18} style={{ marginTop: 1 }} />
      The page’s window on {COMPUTER} is minimized or hidden, so it isn’t drawn.
      The picture comes back when the window shows again.
    </div>
  );
}

const KEYS = ["Enter", "⌫", "Tab", "←", "↑", "↓", "→"];

// The text box (send types the text into the page, no Enter) and the key row.
function Typing({ text }: { text?: string }) {
  return (
    <>
      <div className={s.dock} style={{ paddingBottom: 0 }}>
        <div
          className={s.field}
          data-focus={text !== undefined || undefined}
          style={{ minHeight: 44, paddingRight: 6 }}
        >
          <span
            className={s.grow}
            style={
              text === undefined
                ? { color: "var(--color-text-muted)" }
                : undefined
            }
          >
            {text ?? "Type into the page"}
            {text !== undefined && <span className={s.caret} />}
          </span>
          <span className={s.send} data-off={text === undefined || undefined}>
            <ArrowUp size={20} strokeWidth={2} />
          </span>
        </div>
      </div>
      <div className={c.keys}>
        {KEYS.map((key) => (
          <span key={key} className={c.key}>
            {key}
          </span>
        ))}
      </div>
    </>
  );
}

function ViewOnlyLine() {
  return (
    <div
      className={s.note}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "6px 20px 10px",
      }}
    >
      <Ic icon={KeyboardOff} size={16} style={{ marginTop: 1 }} />
      This phone can only watch pages. To use them, turn on “Allow typing in
      terminals” for this phone in Settings › Remote › My devices on {COMPUTER}.
    </div>
  );
}

export function PageFlow() {
  return (
    <Flow
      title="13 · Agent pages"
      note="컴퓨터의 browser page(agent가 연 것과 폰에서 연 것)를 폰에서 보고 다룬다. 화면 없는 컴퓨터에서 site에 로그인하는 길이다. 그림은 컴퓨터가 그린 page를 폭에 맞춘 것이고, 보는 동안만 온다. 느린 연결에서는 그림이 건너뛰어질 뿐 밀리지 않는다. 다루는 것(누르기, 끌기, 두 손가락 굴리기, 글과 key, 주소, 잡기, 새 page)은 컴퓨터가 터미널 입력을 허락한 폰만 한다."
    >
      <Shot
        title="The sidebar"
        text="Pages는 Agents 아래, 그 컴퓨터의 곳들과 같이 있다. 고르면 그 컴퓨터의 page 목록이다."
      >
        <Phone tone="shell" over={<Sidebar on="pages" />}>
          <PageList open />
        </Phone>
      </Shot>
      <Shot
        title="The computer's pages"
        text="줄마다 page 제목, 주소, 연 agent(사람이 연 것은 You). 맨 위 주소 칸이 그 컴퓨터에 새 page를 연다(다룰 수 있는 폰만). 목록은 page가 열리고 닫힐 때 바뀐다."
      >
        <Phone>
          <PageList open />
        </Phone>
      </Shot>
      <Shot
        title="Open a page"
        text="주소를 적고 보내면 컴퓨터에 page가 열리고 그 page 보기로 간다. scheme이 없으면 https를 붙인다(localhost는 http)."
      >
        <Phone>
          <PageList open typed="accounts.google.com" />
          <Keyboard />
        </Phone>
      </Shot>
      <Shot
        title="A page an agent is using"
        text="위는 뒤로, 주소, 다시 읽기. 주소를 고쳐 보내면 그리로 간다. agent가 다루는 중이면 그 줄과 Take control. 그림을 누르면 누르기, 누른 채 끌면 끌기, 두 손가락으로 밀면 굴리기다. 아래는 글 칸(보내면 글만 친다)과 key 줄."
      >
        <Phone>
          <PageHead />
          <Address />
          <Driver />
          <Picture />
          <Typing />
        </Phone>
      </Shot>
      <Shot
        title="You took control"
        text="잡으면 agent가 멈추고(쓰기 동작이 막힌다) 컴퓨터 화면에도 잡혀 있음이 보인다. Hand back으로 돌려준다. 글 칸을 누르면 keyboard가 뜨고 그림은 남은 자리에 맞게 줄어든다. 여기는 page의 칸을 누른 뒤 글을 보낸 때다."
      >
        <Phone>
          <PageHead />
          <Address />
          <Driver held />
          <Picture typed="mina@phroner.dev" />
          <Typing text="mina@phroner.dev" />
        </Phone>
      </Shot>
      <Shot
        title="Not drawn"
        text="컴퓨터의 창이 최소화되거나 숨겨지면 그림이 오지 않는다. 마지막 그림을 흐리게 두고 그 위에 이유 한 줄."
      >
        <Phone>
          <PageHead />
          <Address />
          <Picture dim over={<NotPainting />} />
          <Typing />
        </Phone>
      </Shot>
      <Shot
        title="Waiting for the picture"
        text="처음 열었거나 컴퓨터가 아직 그림을 보내지 않았다."
      >
        <Phone>
          <PageHead />
          <Address />
          <Waiting>Waiting for the page’s picture…</Waiting>
          <Typing />
        </Phone>
      </Shot>
      <Shot
        title="A phone that may only watch"
        text="터미널 입력을 허락받지 않은 폰은 보기만 한다. 주소는 글로만, 뒤로·다시 읽기·Take control·글 칸·key 줄은 없고, 목록의 주소 칸도 없다. 아래에 켜는 곳 한 줄."
      >
        <Phone>
          <PageHead viewOnly />
          <Address viewOnly />
          <Picture />
          <ViewOnlyLine />
        </Phone>
      </Shot>
    </Flow>
  );
}
