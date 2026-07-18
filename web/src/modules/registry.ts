export type ModuleId = "openclaw" | "hermes" | "codex" | "claude";

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  available: boolean;
  supportsInstances: boolean;
  supportsGatewayLogs: boolean;
}

export const MODULE_REGISTRY: Record<ModuleId, ModuleDefinition> = {
  openclaw: { id: "openclaw", name: "OpenClaw", available: true, supportsInstances: true, supportsGatewayLogs: true },
  hermes: { id: "hermes", name: "Hermes", available: true, supportsInstances: true, supportsGatewayLogs: true },
  codex: { id: "codex", name: "Codex", available: false, supportsInstances: false, supportsGatewayLogs: false },
  claude: { id: "claude", name: "Claude", available: false, supportsInstances: false, supportsGatewayLogs: false },
};

export function moduleDefinition(moduleId: ModuleId): ModuleDefinition {
  return MODULE_REGISTRY[moduleId];
}
