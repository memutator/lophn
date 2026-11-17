// Shared pieces of the phone drafts: the board, the phone frame and the parts every screen is built from.
import {
  ArrowUp,
  BatteryFull,
  ChevronDown,
  ChevronLeft,
  type LucideIcon,
  PanelLeft,
  Plus,
  Signal,
  Square,
  Wifi,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import { AgentCharacter } from "../../../../packages/shell/renderer/parts/avatar/character.tsx";
import { TabStateDot } from "../../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import {
  type Vendor,
  VendorIcon,
} from "../../../../packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx";
import s from "./phone.module.css";

export { s };

// ── board ────────────────────────────────────────────

export function Board({ children }: { children: ReactNode }) {
  return <div className={s.board}>{children}</div>;
}

export function Flow({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className={s.flow}>
      <header className={s.flowHead}>
        <h2 className={s.flowTitle}>{title}</h2>
        <p className={s.flowNote}>{note}</p>
      </header>
      <div className={s.shots}>{children}</div>
    </section>
  );
}

export function Shot({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <figure className={s.shot} style={{ margin: 0 }}>
      {children}
      <figcaption className={s.caption}>
        <p className={s.captionTitle}>{title}</p>
        <p className={s.captionText}>{text}</p>
      </figcaption>
    </figure>
  );
}

// ── phone ────────────────────────────────────────────

export function Phone({
  tone = "base",
  over,
  children,
}: {
  tone?: "base" | "shell" | "floor" | "camera";
  /** Drawn over the whole phone: a scrim with a sheet or the sidebar. */
  over?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.phone} data-tone={tone}>
      <div className={s.status}>
        <span>9:41</span>
        <span className={s.statusIcons}>
          <Signal size={15} strokeWidth={2.2} />
          <Wifi size={15} strokeWidth={2.2} />
          <BatteryFull size={20} strokeWidth={1.8} />
        </span>
      </div>
      <div className={s.screen}>{children}</div>
      <div className={s.homeBar} />
      {over !== undefined && <div className={s.layer}>{over}</div>}
    </div>
  );
}

export function Ic({
  icon: Glyph,
  size = 20,
  className,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.6}
      className={className}
      style={{ flex: "none", ...style }}
    />
  );
}

export function IconBtn({
  icon,
  tone,
  dot,
  size = 22,
}: {
  icon: LucideIcon;
  tone?: "muted" | "camera";
  /** A small mark: something waits behind this button. */
  dot?: boolean;
  size?: number;
}) {
  return (
    <span className={s.iconBtn} data-tone={tone}>
      <Ic icon={icon} size={size} />
      {dot && <span className={s.iconDot} />}
    </span>
  );
}

export function TopBar({
  left = "menu",
  lead,
  title,
  sub,
  under,
  right,
  menuDot,
}: {
  /** menu: opens the sidebar (every top-level place). back: a place inside a place. */
  left?: "menu" | "back" | "close" | "none";
  lead?: ReactNode;
  title: string;
  /** Quieter text on the same line: the session's name after the agent's. */
  sub?: string;
  under?: string;
  right?: ReactNode;
  menuDot?: boolean;
}) {
  return (
    <div className={s.top}>
      {left === "menu" && <IconBtn icon={PanelLeft} dot={menuDot} />}
      {left === "back" && <IconBtn icon={ChevronLeft} size={24} />}
      {left === "close" && <IconBtn icon={X} />}
      <div
        className={s.topMain}
        style={left === "none" ? { paddingLeft: 12 } : undefined}
      >
        {lead}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
            <span
              className={s.topTitle}
              style={{ flex: "none", maxWidth: "100%" }}
            >
              {title}
            </span>
            {sub !== undefined && <span className={s.topSub}>· {sub}</span>}
          </div>
          {under !== undefined && <div className={s.topUnder}>{under}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

// ── identity ─────────────────────────────────────────

type Shape = "square" | "capsule" | "wide" | "pear" | "round" | "arch";
type Color =
  | "coral"
  | "periwinkle"
  | "yellow"
  | "sage"
  | "lavender"
  | "peach"
  | "blue"
  | "teal";

const AGENTS: Record<string, { shape: Shape; color: Color }> = {
  lophn: { shape: "square", color: "coral" },
  "Eval analyst": { shape: "pear", color: "lavender" },
  "Experiment planner": { shape: "round", color: "blue" },
  "Budget reviewer": { shape: "arch", color: "sage" },
  Bookkeeper: { shape: "capsule", color: "yellow" },
};

const VENDORS: Record<string, Vendor> = {
  "Claude Code": "claude",
  Codex: "openai",
};

/** The face of whoever runs a session: a lophn agent's character or a coding agent's vendor icon. */
export function Face({ who, size = 24 }: { who: string; size?: number }) {
  const vendor = VENDORS[who];
  if (vendor !== undefined) {
    return (
      <span className={s.box} style={{ width: size, height: size }}>
        <VendorIcon vendor={vendor} size={Math.round(size * 0.84)} />
      </span>
    );
  }
  const profile = AGENTS[who] ?? AGENTS.lophn!;
  return (
    <span className={s.box} style={{ width: size, height: size }}>
      <AgentCharacter profile={{ kind: "character", ...profile }} />
    </span>
  );
}

export { Avatar };

/** A provider's or a coding agent's own icon. */
export function Vend({ vendor, size = 20 }: { vendor: Vendor; size?: number }) {
  return (
    <span className={s.box} style={{ width: size + 4, height: size + 4 }}>
      <VendorIcon vendor={vendor} size={size} />
    </span>
  );
}

export function Mark({
  kind,
  name,
  tone,
  size,
  icon,
}: {
  kind: "project" | "app";
  name: string;
  tone?: 0 | 1 | 2 | 3 | 4 | 6 | "plain";
  size?: "md" | "lg";
  icon?: LucideIcon;
}) {
  return (
    <span className={s.mark} data-kind={kind} data-tone={tone} data-size={size}>
      {icon === undefined ? (
        name.slice(0, 1)
      ) : (
        <Ic icon={icon} size={size === "lg" ? 24 : 14} />
      )}
    </span>
  );
}

// ── small parts ──────────────────────────────────────

// As the phone kit's Dot: working is the desktop's breathing ink dot (green means a turn ended and not seen), neutral
// and none are gray.
export function Dot({
  tone,
}: {
  tone?: "warning" | "good" | "critical" | "off" | "working" | "neutral";
}) {
  if (tone === "working") return <TabStateDot dot="working" />;
  return <span className={s.dot} data-tone={tone} />;
}

export function Badge({ n }: { n: number }) {
  return <span className={s.badge}>{n}</span>;
}

export function Label({
  children,
  end,
}: {
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className={s.label}>
      <span>{children}</span>
      {end !== undefined && <span className={s.labelEnd}>{end}</span>}
    </div>
  );
}

export function Row({
  lead,
  title,
  sub,
  end,
  strong,
  dim,
  wrap,
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  strong?: boolean;
  dim?: boolean;
  /** Lets the second line wrap. */
  wrap?: boolean;
}) {
  return (
    <div className={s.row} data-dim={dim || undefined}>
      {lead}
      <div className={s.rowMain}>
        <div className={s.rowTitle} data-strong={strong || undefined}>
          {title}
        </div>
        {sub !== undefined && (
          <div className={s.rowSub} data-wrap={wrap || undefined}>
            {sub}
          </div>
        )}
      </div>
      {end !== undefined && <div className={s.rowEnd}>{end}</div>}
    </div>
  );
}

export function Btn({
  variant,
  size,
  icon,
  block,
  disabled,
  children,
}: {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "lg";
  icon?: LucideIcon;
  block?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={s.btn}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      data-disabled={disabled || undefined}
    >
      {icon !== undefined && <Ic icon={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </span>
  );
}

export function Sheet({
  title,
  end,
  children,
}: {
  title?: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className={s.scrim} />
      <div className={s.sheet}>
        <div className={s.grabber} />
        {title !== undefined && (
          <div className={s.sheetHead}>
            <span className={s.sheetTitle}>{title}</span>
            {end}
          </div>
        )}
        {children}
      </div>
    </>
  );
}

export function Tabs({ items, on }: { items: string[]; on: number }) {
  return (
    <div className={s.tabs}>
      {items.map((item, at) => (
        <span key={item} className={s.tab} data-on={at === on || undefined}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function Seg({ items, on }: { items: string[]; on: number }) {
  return (
    <div className={s.seg}>
      {items.map((item, at) => (
        <span key={item} className={s.segItem} data-on={at === on || undefined}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function Chip({
  children,
  lead,
}: {
  children: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <span className={s.cChip}>
      {lead}
      {children}
      <Ic icon={ChevronDown} size={14} />
    </span>
  );
}

export function Composer({
  placeholder,
  value,
  chips,
  action = "off",
  above,
  attach = true,
}: {
  placeholder: string;
  /** Text the person has typed. */
  value?: string;
  chips?: ReactNode;
  /** off: nothing to send. send: text is ready. stop: the agent is working and the draft is empty. */
  action?: "off" | "send" | "stop";
  /** Attachments above the text. */
  above?: ReactNode;
  attach?: boolean;
}) {
  return (
    <div className={s.dock}>
      <div className={s.composer}>
        {above}
        <div className={s.cText} data-empty={value === undefined || undefined}>
          {value ?? placeholder}
          {value !== undefined && <span className={s.caret} />}
        </div>
        <div className={s.cRow}>
          {attach && (
            <span className={s.cBtn}>
              <Ic icon={Plus} size={22} />
            </span>
          )}
          {chips}
          <span className={s.grow} />
          <span className={s.send} data-off={action === "off" || undefined}>
            {action === "stop" ? (
              <Square size={14} strokeWidth={2} fill="currentColor" />
            ) : (
              <ArrowUp size={20} strokeWidth={2} />
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function Keyboard() {
  return (
    <div className={s.kb}>
      {KEYS.map((row, at) => (
        <div key={row} className={s.kbRow}>
          {at === 2 && (
            <span className={s.key} data-wide="">
              ⇧
            </span>
          )}
          {[...row].map((key) => (
            <span key={key} className={s.key}>
              {key}
            </span>
          ))}
          {at === 2 && (
            <span className={s.key} data-wide="">
              ⌫
            </span>
          )}
        </div>
      ))}
      <div className={s.kbRow}>
        <span className={s.key} data-wide="">
          123
        </span>
        <span className={s.key} data-space="">
          space
        </span>
        <span className={s.key} data-wide="">
          ⏎
        </span>
      </div>
    </div>
  );
}
