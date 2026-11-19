// The filter of the one list (tools/wireframes/drafts/phone/shell.tsx Computers): every computer, or one of them with how
// it is reached and what waits on it. Picking one shows only its lines and makes it the computer on screen; every
// connection stays as it is.
import { t } from "@lophn/i18n";
import {
  Badge,
  Divider,
  Dot,
  Icon,
  Row,
  Sheet,
  Text,
  useTheme,
} from "@lophn/ui-native";
import { Check, Layers, type LucideIcon, Monitor, Plus } from "lucide-react-native";
import { View } from "react-native";
import { useComputers, useEveryComputer } from "../data/mod.ts";
import { filterStateOf, stateWithPathOf } from "./computer-state.ts";

function Device({ icon, plain }: { icon: LucideIcon; plain?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: plain ? "transparent" : theme.color.surface.muted,
      }}
    >
      <Icon icon={icon} />
    </View>
  );
}

export function ComputersSheet({
  open,
  onClose,
  onPick,
  onPair,
}: {
  open: boolean;
  onClose: () => void;
  /** After a computer that was not on screen was picked: it is on screen now. */
  onPick: () => void;
  onPair: () => void;
}) {
  const { computers, disputed, current } = useComputers();
  const { filter, setFilter } = useEveryComputer();
  const all = filterStateOf(computers);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("mobile.computer.heading.computers")}
    >
      {computers.length > 1 && (
        <Row
          lead={<Device icon={Layers} />}
          title={t("mobile.computer.filter.all")}
          strong
          sub={
            <>
              <Dot tone={all.tone} />
              <Text variant="small">{all.text}</Text>
            </>
          }
          end={filter === null ? <Icon icon={Check} /> : undefined}
          onPress={() => {
            onClose();
            setFilter(null);
          }}
        />
      )}
      {computers.map((computer) => {
        const state = stateWithPathOf(computer, disputed.has(computer.key));
        const picked = computer.key === filter || computers.length === 1;
        return (
          <Row
            key={computer.key}
            lead={<Device icon={Monitor} />}
            title={computer.name}
            strong
            sub={
              <>
                <Dot tone={state.tone} />
                <Text variant="small">{state.text}</Text>
              </>
            }
            end={
              picked ? (
                <Icon icon={Check} />
              ) : computer.waiting > 0 ? (
                <Badge count={computer.waiting} />
              ) : undefined
            }
            onPress={() => {
              onClose();
              if (computers.length === 1) return;
              setFilter(computer.key);
              if (computer.key !== current) onPick();
            }}
          />
        );
      })}
      <Divider spacing={8} />
      <Row
        lead={<Device icon={Plus} plain />}
        title={t("mobile.computer.button.pair-another")}
        onPress={() => {
          onClose();
          onPair();
        }}
      />
    </Sheet>
  );
}
