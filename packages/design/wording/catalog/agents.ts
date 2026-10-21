export const agents = {
  "agents.button.settings-back": "\u2039 Agents",
  "agents.button.settings-open-lophn": "Open lophn settings",
  "agents.heading.settings-default-model": "Default model",
  "agents.label.providers-custom-key-title": "API key",
  "agents.label.providers-key-hint": "Typed in a protected prompt",
  "agents.label.settings-instructions-path": "~/.lophn/LOPHN.md",
  "agents.label.settings-lophn-chip": "One for all of lophn",
  "agents.label.settings-lophn-grants":
    "Assigned: {apps, plural, one {# app} other {# apps}}",
  "agents.label.settings-lophn-model-default": "Model: Use default ({model})",
  "agents.label.settings-lophn-model-none": "Model: No model chosen yet",
  "agents.label.settings-lophn-model-own": "Model: {model}",
  "agents.notice.providers-custom-key":
    "Typed in a protected prompt after you connect, outside this window.",
  "agents.notice.providers-disconnect-body":
    "lophn forgets the saved key or sign-in for {name}. Agents can't use it until you connect again.",
  "agents.notice.providers-disconnect-failed":
    "Couldn't disconnect. Nothing changed. Try again.",
  "agents.notice.settings-agents-lead":
    "Defaults for every project. A project or an agent can change them.",
  "agents.notice.settings-default-model-help":
    "One model for every agent. A project, or an agent's own settings, can pick another.",
  "agents.notice.settings-lophn-purpose":
    "Talks with you about lophn itself: your projects, apps and settings.",
  "agents.notice.settings-tools-elsewhere":
    "Skills and MCP servers for all projects are in Tools and skills.",
  "agents.notice.settings-tools-lead":
    "The Workspace layer, shared by every project. A project can turn an item off for itself, and an agent can turn it off for itself too.",
  "agents.notice.settings-tools-servers":
    "A server with the same name in a project or an agent replaces this one for that layer.",
  "agents.notice.settings-tools-skills":
    "Skill folders follow the Agent Skills format (SKILL.md). lophn has no built-in skills yet.",
  "agents.notice.stored-in-lophn":
    "Agent definitions are stored in lophn, in one place for every project, not in your project folder.",
  "agents.heading.model-for-project": "Model for this project",
  "agents.label.card-model":
    "Model: {layer, select, agent {{model}} project {project default ({model})} other {Workspace default ({model})}}",
  "agents.notice.model-for-project":
    "One model for every agent in this project. An agent can pick its own in its settings.",
  "agents.notice.skills-project":
    "A switch turns a skill on or off for this project. Workspace skills can be turned off here too.",
  "agents.notice.tab-lead":
    "The agents that work here. lophn is one agent for all of lophn, so you set it up in Settings \u203a Agents.",
  "agents.button.assign-app": "Assign app",
  "agents.button.choose-icon": "Choose icon",
  "agents.button.create-operator": "Create Operator",
  "agents.button.remove-app": "Remove app",
  "agents.button.remove-image": "Remove image",
  "agents.empty.grants-apps":
    "No apps. An assigned app brings all of its tools.",
  "agents.heading.grants-apps": "Apps",
  "agents.heading.server-form": "Add a server for this agent only",
  "agents.label.agent-instructions": "Instructions for this agent",
  "agents.label.auth-api-key": "API key in a header",
  "agents.label.auth-bearer": "Bearer token",
  "agents.label.auth-none": "None",
  "agents.label.avatar-preview": "Avatar preview",
  "agents.label.built-in": "Built-in",
  "agents.label.effect-external": "External",
  "agents.label.effect-read": "Read",
  "agents.label.effect-write": "Write",
  "agents.label.grant-col-allowed": "Allowed",
  "agents.label.grant-col-effect": "Effect",
  "agents.label.grant-col-name": "Name",
  "agents.label.grants-app-tools-summary":
    "{used, number} of {total, number} tools",
  "agents.label.grants-target": "the grants",
  "agents.label.instructions-head-placed":
    "Project instructions \u00b7 LOPHN.md in {project} \u2014 read by every agent placed there",
  "agents.label.instructions-head-unknown":
    "Project instructions \u00b7 LOPHN.md",
  "agents.label.layer-agent": "This agent",
  "agents.label.layer-builtin": "Built-in",
  "agents.label.layer-domain": "Domain",
  "agents.label.layer-global": "Workspace",
  "agents.label.layer-project": "Project",
  "agents.label.model-inherit":
    "Use {layer, select, project {project} other {Workspace}} default \u2014 {model}",
  "agents.label.model-overrides":
    "Overrides {layer, select, project {project} other {Workspace}}",
  "agents.label.no-model-chosen": "No model chosen yet",
  "agents.label.place": "Place",
  "agents.label.place-choice":
    "{name} ({kind, select, app {app} other {project}})",
  "agents.label.place-lophn": "All of lophn",
  "agents.label.place-named": "{name} \u00b7 project",
  "agents.label.place-named-app": "{name} \u00b7 app",
  "agents.label.protected-key": "Key or token",
  "agents.label.role-project-manager": "Project Manager",
  "agents.label.tab-definition": "Definition",
  "agents.label.tab-grants": "Grants",
  "agents.notice.credential-later":
    "If the server needs a key or token, lophn asks for it in a protected prompt after you add it.",
  "agents.notice.domains-gone":
    "A domain this Operator had chosen is gone from here. It is dropped when you save.",
  "agents.notice.grants-after-create":
    "You can assign apps in the Grants tab once the Operator exists.",
  "agents.notice.app-no-project":
    "An app has no project instructions. Only the instructions below apply here.",
  "agents.notice.grants-apply-now": "Changes in Grants apply right away.",
  "agents.notice.grants-lead":
    "What {name} can use besides its own tools. Anything you don't assign here, {name} can't use.",
  "agents.notice.grants-mcp-layers":
    "MCP servers are set where you add them: Settings \u203a Tools and skills, the project, or this Operator's Definition.",
  "agents.notice.instructions-help":
    "Read after the project instructions. Your Workspace instructions come before both.",
  "agents.notice.instructions-help-lophn":
    "Read after your Workspace instructions (Settings \u203a Agents).",
  "agents.notice.lophn-no-project":
    "lophn takes no project's instructions. It reads a project's LOPHN.md when it works on that project.",
  "agents.notice.name-fixed-lophn":
    "There is one lophn for everything. The name can't be changed.",
  "agents.notice.name-fixed-role":
    "Every {owner, select, app {app} other {project}} has one {role}. The name can't be changed.",
  "agents.notice.place-help":
    "Where this Operator works. Its sessions open in that place.",
  "agents.notice.profile-help":
    "An icon, or an image you upload. It shows next to the agent's messages.",
  "agents.notice.protected-key":
    "Typed in a protected prompt after you add the server. It isn't typed here and isn't shown again.",
  "agents.notice.server-name-help":
    "Letters, numbers, dashes and underscores. Other agents don't see this server.",
  "agents.notice.skills-agent-only":
    "The chip says which layer a skill comes from. Switch a skill off to leave it out for this agent. A skill that is off in a layer above stays off.",
  "agents.notice.skills-dropped":
    "Left out because their domain is no longer chosen: {names}.",
  "agents.title.change-failed": "Couldn't change that",
  "agents.title.delete-failed": "Couldn't delete",
  "agents.title.providers-disconnect": "Disconnect {name}?",
  "agents.title.save-conflict": "Changed since you opened it",
  "agents.title.save-failed": "Couldn't save",
  "agents.title.upload-failed": "Couldn't upload",
  "project-workspace.button.add-server": "Add server",
  "project-workspace.button.add-skill": "Add skill",
  "project-workspace.button.agent-editor-delete": "Delete Operator",
  "project-workspace.button.agent-editor-delete-confirm": "Delete",
  "project-workspace.button.agent-editor-edit-project": "Edit LOPHN.md",
  "project-workspace.button.agent-editor-save": "Save",
  "project-workspace.button.agent-editor-upload-image": "Upload image",
  "project-workspace.button.edit-instructions": "Edit",
  "project-workspace.button.new-operator": "New Operator",
  "project-workspace.button.open-agent": "Open",
  "project-workspace.empty.agent-editor-no-project":
    "This project has no instructions yet.",
  "project-workspace.empty.no-instructions": "LOPHN.md is empty.",
  "project-workspace.empty.no-mcp-servers": "No MCP servers registered yet.",
  "project-workspace.empty.no-skills": "No skills registered yet.",
  "project-workspace.heading.agent-editor-delete-title": "Delete {name}?",
  "project-workspace.heading.agent-editor-mcp": "MCP servers",
  "project-workspace.heading.agent-editor-model": "Model",
  "project-workspace.heading.agent-editor-profile": "Profile",
  "project-workspace.heading.agent-editor-skills": "Skills",
  "project-workspace.heading.agents-in-project": "Agents in {project}",
  "project-workspace.heading.agents-new-operator": "New Operator",
  "project-workspace.heading.instructions": "Instructions",
  "project-workspace.heading.mcp-servers": "MCP servers",
  "project-workspace.heading.skills": "Skills",
  "project-workspace.info.instructions-file":
    "Your project's AGENTS.md is for coding agents. lophn agents read LOPHN.md.",
  "project-workspace.label.agent-counts":
    "{skills, plural, one {# skill} other {# skills}} · {mcp, number} MCP",
  "project-workspace.label.agent-counts-unknown":
    "Can't count until its file is fixed",
  "project-workspace.label.agent-editor-icons": "Icon",
  "project-workspace.label.agent-editor-image-file": "Image file",
  "project-workspace.label.agent-editor-instructions": "Instructions",
  "project-workspace.label.agent-editor-model-unset":
    "Use project default — none chosen yet",
  "project-workspace.label.agent-editor-name": "Name",
  "project-workspace.label.agent-kind-operator": "Operator",
  "project-workspace.label.agent-no-model": "No model",
  "project-workspace.label.agents-target": "the agents",
  "project-workspace.label.avatar-icon-apps": "Apps",
  "project-workspace.label.avatar-icon-bookmark": "Bookmark",
  "project-workspace.label.avatar-icon-compare": "Compare",
  "project-workspace.label.avatar-icon-contexts": "Library",
  "project-workspace.label.avatar-icon-dock": "Chat",
  "project-workspace.label.avatar-icon-documents": "Documents",
  "project-workspace.label.avatar-icon-edit": "Pencil",
  "project-workspace.label.avatar-icon-read": "Reading",
  "project-workspace.label.avatar-icon-roles": "People",
  "project-workspace.label.avatar-icon-search": "Search",
  "project-workspace.label.avatar-icon-series": "Series",
  "project-workspace.label.avatar-icon-terminal": "Terminal",
  "project-workspace.label.instructions-shared":
    "Shared by every agent in {project}",
  "project-workspace.label.open-agent-named": "Open {name}",
  "project-workspace.label.role-app-engineer": "App Engineer",
  "project-workspace.label.role-lophn": "lophn",
  "project-workspace.label.role-operators": "Operators",
  "project-workspace.notice.agent-editor-delete-body":
    "Its open sessions close. The conversations stay.",
  "project-workspace.notice.agent-editor-issue":
    "{code, select, malformed {This part couldn't be read} unknownField {This field isn't recognized} invalidValue {This value isn't allowed} required {This is required} notAllowed {This isn't allowed here} reservedName {This name is reserved} duplicate {This is already in use} tooLarge {This is too large} overCap {This is wider than the project allows} other {This couldn't be saved}}.",
  "project-workspace.notice.agent-editor-model-help":
    "Only the fields you change are saved; the rest follow project and Workspace defaults.",
  "project-workspace.notice.agent-editor-save-first":
    "Save first to upload an image.",
  "project-workspace.notice.agents-change-failed":
    "Couldn't change that. Nothing changed.",
  "project-workspace.notice.agents-delete-failed":
    "Couldn't delete this agent. Nothing changed.",
  "project-workspace.notice.agents-save-conflict":
    "This agent changed after you opened it. Cancel and open it again.",
  "project-workspace.notice.agents-save-failed":
    "Couldn't save this agent. Nothing changed.",
  "project-workspace.notice.agents-upload-failed":
    "Couldn't upload that image. Nothing changed.",
  "settings.agents.action-failed":
    "That didn't work. Nothing changed. Try again.",
  "settings.agents.no-instructions": "No instructions yet.",
  "settings.agents.no-servers": "No MCP servers yet.",
  "settings.agents.no-skills": "No skills yet.",
  "settings.button.add-server": "Add server",
  "settings.button.add-skill": "Add skill",
  "settings.button.disconnect": "Disconnect",
  "settings.button.edit": "Edit",
  "settings.button.save": "Save",
  "settings.button.skip": "Skip",
  "settings.error.connect-failed":
    "Couldn't connect. Nothing changed. Try again.",
  "settings.error.custom-id":
    "Use lowercase letters, numbers, hyphens or underscores.",
  "settings.error.custom-name": "Enter a display name.",
  "settings.error.custom-url": "Use https, or http only for this computer.",
  "settings.error.sign-in-expired":
    "The sign-in took too long. Nothing changed. Try again.",
  "settings.error.sign-in-refused":
    "This account can't be used here. Nothing changed. Try another account or an API key.",
  "settings.extensions.server-added":
    "{name} is added. New work can use it once any credential is saved.",
  "settings.extensions.server-failed":
    "{name} wasn't added. Nothing changed. Check the details and add it again.",
  "settings.heading.add-provider": "Add a provider",
  "settings.heading.agents-instructions": "Instructions for all projects",
  "settings.heading.agents-servers": "MCP servers (all projects)",
  "settings.heading.agents-skills": "Skills (all projects)",
  "settings.heading.connected": "Connected",
  "settings.label.agents-target": "your agent settings",
  "settings.label.available-target": "the providers you can add",
  "settings.label.api-anthropic-messages": "Anthropic Messages",
  "settings.label.api-openai-chat-completions": "Chat Completions",
  "settings.label.api-openai-responses": "Responses",
  "settings.label.custom-api": "API",
  "settings.label.custom-id": "Provider ID",
  "settings.label.custom-name": "Display name",
  "settings.label.custom-provider-hint":
    "Any server that speaks the OpenAI or Anthropic API",
  "settings.label.custom-url": "Base URL",
  "settings.label.extensions-target": "your tools and skills",
  "settings.label.login-signed-in": "Signed in",
  "settings.label.method-continue": "Continue with {product}",
  "settings.label.method-opens-browser": "Opens your browser",
  "settings.label.method-sign-in": "Sign in with {product}",
  "settings.label.off": "Off",
  "settings.label.on-computer": "Runs on this computer",
  "settings.label.over-web": "Connects over the web",
  "settings.label.providers-target": "your connections",
  "settings.label.role-lophn": "lophn",
  "settings.label.server-address": "Address",
  "settings.label.server-arguments": "Arguments",
  "settings.label.server-auth": "Sign-in",
  "settings.label.server-header": "Header name",
  "settings.label.server-name": "Name",
  "settings.label.server-program": "Program",
  "settings.label.server-transport": "How it connects",
  "settings.label.sign-in-how": "How do you want to sign in to {name}?",
  "settings.label.status-connected": "Connected",
  "settings.label.status-needs-sign-in": "Needs sign-in",
  "settings.notice.choose-default-model":
    "Agents use this model unless a project or an agent picks another. You can change it later in Settings → Agents.",
  "settings.notice.custom-id-help":
    "Lowercase letters, numbers, hyphens or underscores.",
  "settings.notice.custom-lead":
    "Set up a server that speaks the OpenAI or Anthropic API.",
  "settings.notice.custom-url-help":
    "The address goes right before /chat/completions, /responses or /messages, for example https://api.example.com/v1.",
  "settings.notice.none-connected": "No providers are connected yet.",
  "settings.notice.provider-lead":
    "A provider is a service you connect with one key or sign-in. You pick models in the model picker and in Settings → Agents.",
  "settings.notice.sign-in-browser":
    "Finish signing in to {product} in your browser.",
  "settings.notice.sign-in-code":
    "Enter this code on the page that opened in your browser.",
  "settings.server.address-help":
    "A secure web address, or one on this computer.",
  "settings.server.arguments-help": "One per line. They are passed as written.",
  "settings.server.error-header": "Use letters, numbers and dashes, up to 64.",
  "settings.server.error-name":
    "Use letters, numbers, dashes and underscores, up to 32.",
  "settings.server.error-path":
    "Enter the full path of the program, starting from the top folder.",
  "settings.server.error-taken": "A server with this name already exists.",
  "settings.server.error-url":
    "Enter a secure web address, or one on this computer.",
  "settings.server.program-help":
    "The full path of the program to start on this computer.",
  "settings.status.plan-access":
    "Your plan doesn't allow this. Check that your plan includes it.",
  "settings.status.sign-in-problem":
    "There's a sign-in problem. Disconnect, then connect again.",
  "settings.status.sign-in-waiting": "Waiting for you to finish signing in.",
  "settings.status.usage-limit":
    "Usage limit reached. Wait for the limit to reset.",
  "settings.title.choose-default-model": "Choose a default model",
  "settings.title.connect-provider": "Connect {name}",
  "settings.title.custom-provider": "Custom provider",
} as const;
