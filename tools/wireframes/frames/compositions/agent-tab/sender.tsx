// 받은 메시지의 보낸 쪽 chip과, chip을 누르면 열리는 panel. 사람이 직접 쓴 메시지가 아닌 입력(다른 agent의 부탁,
// program의 reaction, coding agent의 메시지, 배달 알림)이 chip을 단다. panel은 맡긴 글, 근거 링크, 보낸 session을 읽어 보인다.
import { type ReactNode, useState } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { Link } from "../link.tsx";
import { VendorIcon, vendorOf } from "../../vendors/vendor-icon.tsx";
import { type Envelope, EVIDENCE_KIND, senderLabel } from "./data.ts";
import t from "./agent-tab.module.css";

/** coding agent가 보냈으면 그 harness의 vendor 아이콘. */
function ProductIcon({ envelope }: { envelope: Envelope }) {
  const { sender } = envelope;
  if (sender.kind !== "coding") return null;
  const vendor = vendorOf(sender.product);
  return vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />;
}

/** "From …" chip. 누르면 panel이 열린다. */
export function SenderChip(
  { envelope, open, onToggle }: {
    envelope: Envelope;
    open: boolean;
    onToggle: () => void;
  },
) {
  return (
    <button
      type="button"
      className={t.senderChip}
      aria-expanded={open}
      aria-label={`Sent by ${senderLabel(envelope.sender)}`}
      onClick={onToggle}
    >
      <span className={t.senderFrom}>From</span>
      <ProductIcon envelope={envelope} />
      <span className={t.senderName}>{senderLabel(envelope.sender)}</span>
      <Icon
        icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
        pixels={iconPixels("small")}
      />
    </button>
  );
}

/** chip 아래로 펼쳐지는 panel: 맡긴 글, 근거 링크, 보낸 session 링크. */
export function SenderPanel({ envelope }: { envelope: Envelope }) {
  const { sender } = envelope;
  const title = sender.kind === "reaction"
    ? "What lophn saw"
    : sender.kind === "program"
    ? "Why you got this"
    : "What was handed over";
  return (
    <section className={t.senderPanel} aria-label="Sender details">
      <div className={t.senderBlock}>
        <p className={t.senderHead}>{title}</p>
        <p className={t.senderTask}>{envelope.task}</p>
      </div>
      {envelope.refs.length === 0 ? null : (
        <div className={t.senderBlock}>
          <p className={t.senderHead}>Based on</p>
          <ul className={t.refList}>
            {envelope.refs.map((ref) => (
              <li key={ref.text} className={t.refRow}>
                <span className={t.refKind}>{EVIDENCE_KIND[ref.kind]}</span>
                <Link onClick={() => {}}>{ref.text}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {envelope.session === undefined ? null : (
        <div className={t.senderBlock}>
          <p className={t.senderHead}>Sent from</p>
          <p className={t.sessionLink}>
            {sender.kind === "coding" && vendorOf(sender.product) !== undefined
              ? <VendorIcon vendor={vendorOf(sender.product)!} size={14} />
              : (
                <Icon
                  icon={lophnSpaceIcons.openLink}
                  pixels={iconPixels("small")}
                />
              )}
            <Link onClick={() => {}}>{envelope.session}</Link>
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * 받은 메시지 한 개. 왼쪽에 놓이고(내 메시지는 오른쪽 bubble) 위에 보낸 쪽 chip이 붙는다.
 * `replyTo`가 있으면 어느 부탁에 대한 답인지 한 줄로 잇는다.
 */
export function ReceivedMessage(
  { envelope, time, replyTo, defaultOpen = false, children }: {
    envelope: Envelope;
    time: string;
    replyTo?: string;
    defaultOpen?: boolean;
    children: ReactNode;
  },
) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={t.received}>
      <div className={t.receivedHead}>
        <SenderChip
          envelope={envelope}
          open={open}
          onToggle={() => setOpen(!open)}
        />
        <span className={t.time}>{time}</span>
      </div>
      {open ? <SenderPanel envelope={envelope} /> : null}
      {replyTo === undefined
        ? null
        : <p className={t.replyTo}>Reply to: {replyTo}</p>}
      <div className={t.receivedBody}>{children}</div>
    </div>
  );
}
