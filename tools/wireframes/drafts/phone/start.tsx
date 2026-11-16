// Flow 1. First launch: pairing this phone with a computer.

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Check,
  ClockAlert,
  Flashlight,
  Monitor,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentCharacter } from "../../../../packages/shell/renderer/parts/avatar/character.tsx";
import {
  Btn,
  Flow,
  Ic,
  IconBtn,
  Keyboard,
  Phone,
  Sheet,
  Shot,
  s,
} from "./kit.tsx";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className={s.step}>
      <span className={s.stepNo}>{n}</span>
      <span>{children}</span>
    </div>
  );
}

function Welcome({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <div className={s.center}>
        <span className={s.box} style={{ width: 92, height: 92 }}>
          <AgentCharacter
            profile={{ kind: "character", shape: "square", color: "coral" }}
          />
        </span>
        <h1 className={s.hero}>lophn on your phone</h1>
        <p className={s.lead}>
          Use your apps, talk to your agents and answer what they ask, wherever
          you are.
        </p>
        <div className={s.plain} style={{ width: "100%", marginTop: 28 }}>
          <Step n={1}>Open lophn on your computer</Step>
          <div className={s.hair} style={{ margin: "0 16px" }} />
          <Step n={2}>
            Go to <b>Settings › Remote</b>
          </Step>
          <div className={s.hair} style={{ margin: "0 16px" }} />
          <Step n={3}>
            Choose <b>Add a phone</b> and scan the code it shows
          </Step>
        </div>
      </div>
      <div className={s.foot}>
        <Btn variant="primary" size="lg" icon={QrCode}>
          Scan the code
        </Btn>
        <Btn variant="ghost">Enter a pairing code instead</Btn>
        <p
          className={s.note}
          style={{ margin: "4px 0 0", textAlign: "center" }}
        >
          End-to-end encrypted. Only this phone and your computer can read what
          passes between them.
        </p>
      </div>
    </Phone>
  );
}

function Scanner() {
  return (
    <Phone tone="camera">
      <div className={s.top}>
        <IconBtn icon={X} tone="camera" />
        <span className={s.grow} />
        <IconBtn icon={Flashlight} tone="camera" />
      </div>
      <div className={s.center}>
        <div className={s.finder}>
          <div className={s.qr} />
        </div>
        <p style={{ margin: "32px 0 0", fontSize: 18, fontWeight: 600 }}>
          Scan the code on your computer
        </p>
        <p
          style={{
            margin: "6px 0 0",
            color: "rgba(243,243,240,0.66)",
            fontSize: 14,
            lineHeight: "20px",
          }}
        >
          Settings › Remote › Add a phone
        </p>
      </div>
      <div
        className={s.foot}
        style={{ justifyItems: "center", paddingBottom: 24 }}
      >
        <span
          className={s.pill}
          style={{
            height: 40,
            padding: "0 16px",
            borderColor: "rgba(255,255,255,0.24)",
            color: "#f3f3f0",
            fontSize: 14,
          }}
        >
          Enter a pairing code instead
        </span>
      </div>
    </Phone>
  );
}

function Progress({
  state,
  children,
}: {
  state: "done" | "now" | "next";
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 15,
        lineHeight: "22px",
        color:
          state === "next"
            ? "var(--color-text-disabled)"
            : "var(--color-text-primary)",
      }}
    >
      {state === "done" ? (
        <Ic icon={Check} size={18} className={s.good} />
      ) : (
        <span
          style={{
            width: 18,
            height: 18,
            boxSizing: "border-box",
            border: "2px solid var(--color-border-strong)",
            borderTopColor:
              state === "now" ? "var(--color-text-primary)" : undefined,
            borderRadius: 999,
          }}
        />
      )}
      {children}
    </div>
  );
}

function Pairing() {
  return (
    <Phone>
      <div className={s.center}>
        <div className={s.link3}>
          <span className={s.device}>
            <Ic icon={Smartphone} size={28} />
          </span>
          <span className={s.dots}>
            <span />
            <span />
            <span />
          </span>
          <span className={s.device}>
            <Ic icon={Monitor} size={28} />
          </span>
        </div>
        <h1
          className={s.hero}
          style={{ marginTop: 28, fontSize: 24, lineHeight: "32px" }}
        >
          Pairing with mina-desktop
        </h1>
        <div
          style={{ display: "grid", gap: 12, marginTop: 28, textAlign: "left" }}
        >
          <Progress state="done">Code accepted</Progress>
          <Progress state="done">Keys exchanged</Progress>
          <Progress state="now">Opening the connection…</Progress>
        </div>
      </div>
      <div className={s.foot}>
        <Btn variant="ghost">Cancel</Btn>
      </div>
    </Phone>
  );
}

function Paired() {
  return (
    <Phone>
      <div className={s.center}>
        <span className={s.circle}>
          <Ic icon={Check} size={34} className={s.good} />
        </span>
        <h1 className={s.hero} style={{ fontSize: 24, lineHeight: "32px" }}>
          Paired with mina-desktop
        </h1>
        <p className={s.lead}>
          This phone now shows under Settings › Remote on that computer. You can
          remove it from either side.
        </p>
        <div
          className={s.plain}
          style={{
            display: "grid",
            gap: 6,
            width: "100%",
            marginTop: 28,
            padding: 16,
            boxSizing: "border-box",
            textAlign: "left",
          }}
        >
          <span className={s.fieldLabel}>Shown as</span>
          <div className={s.field}>
            <span className={s.muted}>mina-desktop</span>
          </div>
        </div>
        <div
          className={s.plain}
          style={{
            display: "flex",
            gap: 12,
            width: "100%",
            marginTop: 12,
            padding: 16,
            boxSizing: "border-box",
            textAlign: "left",
          }}
        >
          <Ic icon={Bell} size={22} style={{ marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, lineHeight: "22px" }}>
              Know when you are needed
            </div>
            <div className={s.note} style={{ marginTop: 4 }}>
              Get a notification when an agent asks for approval, has a
              question, or finishes long work. Notifications never show what was
              said.
            </div>
          </div>
        </div>
      </div>
      <div className={s.foot}>
        <Btn variant="primary" size="lg" icon={Bell}>
          Turn on notifications
        </Btn>
        <Btn variant="ghost">Not now</Btn>
      </div>
    </Phone>
  );
}

function Failed({
  icon,
  title,
  text,
  primary,
  primaryIcon = QrCode,
  secondary,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  primary: string;
  primaryIcon?: LucideIcon;
  secondary: string;
}) {
  return (
    <Phone>
      <div className={s.center}>
        <span className={s.circle}>
          <Ic icon={icon} size={32} className={s.warnIcon} />
        </span>
        <h1 className={s.hero} style={{ fontSize: 24, lineHeight: "32px" }}>
          {title}
        </h1>
        <p className={s.lead}>{text}</p>
      </div>
      <div className={s.foot}>
        <Btn variant="primary" size="lg" icon={primaryIcon}>
          {primary}
        </Btn>
        <Btn variant="ghost">{secondary}</Btn>
      </div>
    </Phone>
  );
}

function EnterCode() {
  return (
    <Welcome
      over={
        <Sheet title="Enter a pairing code">
          <div
            className={s.pad}
            style={{ display: "grid", gap: 12, paddingBottom: 14 }}
          >
            <p className={s.note} style={{ margin: 0 }}>
              Under the QR code on your computer choose <b>Show as text</b>,
              copy it and paste it here. A code works once, for five minutes.
            </p>
            <div className={s.field} data-focus="">
              <span className={s.muted}>Pairing code</span>
            </div>
            <div className={s.btnRow}>
              <Btn block>Paste</Btn>
              <Btn block variant="primary" disabled>
                Pair
              </Btn>
            </div>
          </div>
          <Keyboard />
        </Sheet>
      }
    />
  );
}

export function StartFlow() {
  return (
    <Flow
      title="1 · Start and pair"
      note="처음 켰을 때. 폰은 컴퓨터의 lophn에 QR로 붙는다. 계정도 로그인도 없다. 연결되면 바로 알림을 켤지 묻고 Home으로 간다. 컴퓨터를 더 붙일 때도 Scan the code부터 같은 길이다."
    >
      <Shot
        title="Welcome"
        text="무엇을 하는 앱인지 한 줄, 컴퓨터에서 할 일 세 줄, 단추 하나. camera를 못 쓰면 code를 붙여 넣는다."
      >
        <Welcome />
      </Shot>
      <Shot
        title="Scan"
        text="camera 권한은 이 화면에 들어올 때 묻는다. 플래시와 code 붙여 넣기로 빠지는 길만 둔다."
      >
        <Scanner />
      </Shot>
      <Shot
        title="Pairing"
        text="code를 읽으면 바로 넘어온다. 어디까지 됐는지 세 줄로 보이고 보통 1~2초 안에 끝난다."
      >
        <Pairing />
      </Shot>
      <Shot
        title="Paired"
        text="붙은 컴퓨터가 스스로 알린 이름으로 확인시킨다. Shown as는 비워 두면 그 이름이 계속 보이고(회색 글자가 그 이름), 무언가 쓰면 이 폰에서만 그 별명으로 보인다. 폰을 쓰는 가장 큰 이유인 알림은 여기서 한 번 묻는다. Not now여도 설정에서 켠다."
      >
        <Paired />
      </Shot>
      <Shot
        title="Code expired"
        text="code는 5분, 한 번만 쓴다. 지난 code를 읽으면 무엇을 다시 하면 되는지 말한다."
      >
        <Failed
          icon={ClockAlert}
          title="This code has expired"
          text="Codes last five minutes. Choose New code in Settings › Remote on your computer and scan again."
          primary="Scan again"
          secondary="Enter a pairing code instead"
        />
      </Shot>
      <Shot
        title="Cannot reach the computer"
        text="code는 맞는데 연결이 열리지 않을 때. 컴퓨터 쪽에서 확인할 것을 말하고 같은 code로 다시 해 본다."
      >
        <Failed
          icon={Unplug}
          title="Cannot reach mina-desktop"
          text="The code is fine but the connection did not open. Check that lophn is running on the computer and that it is online."
          primary="Try again"
          primaryIcon={RefreshCw}
          secondary="Scan a different code"
        />
      </Shot>
      <Shot
        title="Enter a pairing code"
        text="camera가 없거나 고장 났을 때. 컴퓨터가 보여 주는 글 code를 붙여 넣는다."
      >
        <EnterCode />
      </Shot>
    </Flow>
  );
}
