// One computer's providers (tools/wireframes/drafts/phone/more.tsx Providers): what is connected and what can be. The phone
// connects with an API key or a sign-in that ends in any browser (device code). A sign-in that must come back to the
// computer's own browser, Custom providers, disconnecting and the default model stay on the computer.
import { t } from "@lophn/i18n";
import { Button, Divider, Dot, Group, Icon, Label, Row, Screen, Sheet, Text, TopBar } from "@lophn/ui-native";
import { Check, ChevronRight, ExternalLink, KeyRound, LogIn } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { vendorOf } from "../../../../shell/renderer/parts/vendor-icon/vendors.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  oauthFlowOf,
  type ProviderDefinitionView,
  type ProviderRecord,
  type SignInStarted,
  useComputers,
  useProviders,
  useSetup,
} from "../../data/mod.ts";
import { VendorIcon } from "../../parts/mod.ts";
import { SignInCode, signInFailure, useSecretField } from "./setup-parts.tsx";

const NEXT = <Icon icon={ChevronRight} size={16} />;

function Mark({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return (
    <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      {vendor === undefined ? <Icon icon={KeyRound} /> : <VendorIcon vendor={vendor} size={20} />}
    </View>
  );
}

/** What the phone can connect a definition with. */
function waysOf(definition: ProviderDefinitionView): { key: boolean; code: boolean } {
  const { oauth } = definition;
  return {
    key: definition.auth_kinds.includes("api_key"),
    code: oauth !== null && oauthFlowOf(oauth.product) === "device_code",
  };
}

function Connected({ provider }: { provider: ProviderRecord }) {
  const available = provider.credential.state === "available";
  return (
    <Row
      lead={<Mark name={provider.definition.key} />}
      title={provider.name}
      sub={t(provider.credential.kind === "oauth" ? "settings.label.auth-sign-in" : "settings.label.auth-api-key")}
      end={
        <>
          <Dot tone={available ? "good" : "warning"} />
          <Text variant="small">
            {t(available ? "settings.label.status-connected" : "settings.label.status-needs-sign-in")}
          </Text>
        </>
      }
    />
  );
}

export function ProvidersScreen({ place }: { place: PlaceOf<"providers"> }) {
  const nav = useNav();
  const { computers } = useComputers();
  const computer = computers.find((one) => one.key === place.key)?.name ?? "";
  const loaded = useProviders(place.key);
  const [connecting, setConnecting] = useState<ProviderDefinitionView | null>(null);
  let body: ReactNode;
  if (loaded.state === "loading") body = null;
  else if (loaded.state === "failed") {
    body = (
      <Text tone="muted" style={{ margin: 20 }}>
        {t("mobile.places.failed")}
      </Text>
    );
  } else if (loaded.value === "forbidden") {
    body = (
      <Text tone="muted" style={{ margin: 20 }}>
        {t("mobile.setup.notice.not-allowed", { computer })}
      </Text>
    );
  } else {
    const { connected, available } = loaded.value;
    body = (
      <>
        <Label>{t("settings.heading.connected")}</Label>
        {connected.length === 0 ? (
          <Text variant="note" tone="muted" style={{ marginHorizontal: 20 }}>
            {t("settings.notice.none-connected")}
          </Text>
        ) : (
          <Group>
            {connected.map((provider, at) => (
              <View key={provider.id}>
                {at > 0 && <Divider />}
                <Connected provider={provider} />
              </View>
            ))}
          </Group>
        )}
        {available.length > 0 && (
          <>
            <Label>{t("settings.heading.add-provider")}</Label>
            <Group>
              {available.map((definition, at) => {
                const ways = waysOf(definition);
                const usable = ways.key || ways.code;
                return (
                  <View key={definition.key}>
                    {at > 0 && <Divider />}
                    <Row
                      lead={<Mark name={definition.key} />}
                      title={definition.display_name}
                      sub={usable ? undefined : t("mobile.providers.label.on-computer", { computer })}
                      dim={!usable}
                      end={usable ? NEXT : undefined}
                      onPress={usable ? () => setConnecting(definition) : undefined}
                    />
                  </View>
                );
              })}
            </Group>
          </>
        )}
        <Text variant="note" tone="muted" style={{ marginTop: 8, marginHorizontal: 20 }}>
          {t("mobile.providers.note.lead")}
        </Text>
      </>
    );
  }
  return (
    <Screen
      tone="floor"
      top={<TopBar left="back" onLeft={nav.back} title={t("settings.label.tab-providers")} under={computer} />}
      scroll
    >
      {body}
      <Sheet
        open={connecting !== null}
        onClose={() => setConnecting(null)}
        title={connecting === null ? undefined : t("settings.title.connect-provider", { name: connecting.display_name })}
      >
        {connecting !== null && (
          <Connect
            definition={connecting}
            computerKey={place.key}
            computer={computer}
            onClose={() => setConnecting(null)}
          />
        )}
      </Sheet>
    </Screen>
  );
}

type Step = "choose" | "key" | "code";

/** The Connect sheet's body. Mounted only while the sheet is open, so a typed key and a started sign-in end with it. */
interface ConnectProps {
  definition: ProviderDefinitionView;
  /** The computer's key; `computer` is its name. */
  computerKey: string;
  computer: string;
  onClose: () => void;
}

function Connect(props: ConnectProps) {
  const { definition } = props;
  const ways = waysOf(definition);
  const [step, setStep] = useState<Step>(ways.key && ways.code ? "choose" : ways.key ? "key" : "code");
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
      {step === "choose" ? (
        <>
          <Row lead={<Icon icon={KeyRound} />} title={t("settings.label.auth-api-key")} end={NEXT} onPress={() => setStep("key")} />
          <Row
            lead={<Mark name={definition.key} />}
            title={t("settings.label.method-sign-in", { product: definition.display_name })}
            sub={t("mobile.providers.label.both")}
            end={NEXT}
            onPress={() => setStep("code")}
          />
        </>
      ) : step === "key" ? (
        <KeyForm {...props} />
      ) : (
        <CodeSignIn {...props} />
      )}
    </View>
  );
}

function keyFailure(code: string, computer: string): string {
  if (code === "forbidden") return t("mobile.setup.notice.not-allowed", { computer });
  return t(code === "invalid_input" ? "secret-input.error.invalid" : "settings.error.connect-failed");
}

function KeyForm({ definition, computerKey, computer, onClose }: ConnectProps) {
  const setup = useSetup(computerKey);
  const secret = useSecretField({ label: t("settings.label.auth-api-key"), autoFocus: true });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setFailed(null);
    const sent = await setup.connectKey(definition.key, secret.take());
    setBusy(false);
    if (sent.ok) onClose();
    else setFailed(keyFailure(sent.code, computer));
  };
  return (
    <View style={{ gap: 10 }}>
      <Text variant="caption" tone="muted">
        {t("settings.label.auth-api-key")}
      </Text>
      {secret.field}
      <Text variant="note" tone={failed === null ? "muted" : "critical"}>
        {failed ?? t("secret-input.help.value")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button block disabled={busy} onPress={onClose}>
          {t("common.button.cancel")}
        </Button>
        <Button block variant="primary" icon={Check} disabled={busy || !secret.filled} onPress={() => void save()}>
          {t("secret-input.button.save")}
        </Button>
      </View>
    </View>
  );
}

/**
 * Starts the sign-in as it opens and closes the sheet once the computer is connected (the list then shows it). Closing it
 * before the end stops the sign-in on the computer.
 */
function CodeSignIn({ definition, computerKey, computer, onClose }: ConnectProps) {
  const setup = useSetup(computerKey);
  const [started, setStarted] = useState<SignInStarted | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The sign-in to stop if the sheet goes away before it ends.
  const open = useRef<SignInStarted | null>(null);

  const start = async () => {
    setFailed(null);
    const begun = await setup.startSignIn({ definition: definition.key });
    if (!begun.ok) {
      setFailed(begun.code === "forbidden" ? t("mobile.setup.notice.not-allowed", { computer }) : signInFailure(begun.code));
      return;
    }
    open.current = begun.value;
    setStarted(begun.value);
  };

  useEffect(() => {
    void start();
    return () => {
      if (open.current !== null) void setup.cancelSignIn(open.current);
    };
    // Starts once, when the sheet opens on this step.
  }, []);

  useEffect(() => {
    if (started === null) return;
    return setup.followSignIn(started.login, (outcome) => {
      open.current = null;
      setStarted(null);
      if (outcome === "connected") onClose();
      else if (typeof outcome === "object") setFailed(signInFailure(outcome.failed));
    });
  }, [setup, started]);

  return (
    <View>
      {started !== null && <SignInCode code={started.code} />}
      {failed !== null && (
        <Text variant="note" tone="critical" style={{ marginTop: 10 }}>
          {failed}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Button block onPress={onClose}>
          {t("common.button.cancel")}
        </Button>
        {started !== null ? (
          <Button block variant="primary" icon={ExternalLink} onPress={() => void Linking.openURL(started.url)}>
            {t("mobile.setup.button.open-page")}
          </Button>
        ) : (
          failed !== null && (
            <Button block variant="primary" icon={LogIn} onPress={() => void start()}>
              {t("conversation.button.input-request-sign-in")}
            </Button>
          )
        )}
      </View>
    </View>
  );
}
