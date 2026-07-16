import type { ModuleId } from "../modules/registry";
import { GatewayClient } from "./gatewayClient";
import { clientFromGuiUrl } from "./hermesApi";
import { sortModuleSessions, type ModuleSession } from "./moduleSessionProtocol";

function toTimestamp(value: number | undefined): number {
  if (!value) return Date.now();
  return value < 10_000_000_000 ? value * 1000 : value;
}

async function withOpenClawGateway<T>(operation: (gateway: GatewayClient) => Promise<T>): Promise<T> {
  const gateway = await GatewayClient.create();
  gateway.connect();
  try {
    await gateway.ready;
    return await operation(gateway);
  } finally {
    gateway.close();
  }
}

export async function listModuleSessions(
  moduleId: ModuleId,
  guiUrl?: string | null,
): Promise<ModuleSession[]> {
  if (moduleId === "openclaw") {
    const sessions = await withOpenClawGateway((gateway) =>
      gateway.listSessions({ limit: 200, includeDerivedTitles: true, includeLastMessage: true }),
    );
    return sortModuleSessions(sessions.map((session) => ({
      id: session.key,
      moduleId,
      title: session.label || session.origin?.label || "新会话",
      lastMessage: session.lastMessage?.preview,
      updatedAt: toTimestamp(session.updatedAt),
      createdAt: toTimestamp(session.createdAt),
    })));
  }

  if (moduleId === "hermes") {
    const client = clientFromGuiUrl(guiUrl);
    try {
      const sessions = await client.listDashboardSessions();
      return sortModuleSessions(sessions.map((session) => ({
        id: session.id,
        moduleId,
        title: session.title || "新会话",
        lastMessage: session.lastMessage,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      })));
    } finally {
      client.dispose();
    }
  }

  return [];
}

export async function createModuleSession(
  moduleId: ModuleId,
  guiUrl?: string | null,
): Promise<ModuleSession> {
  if (moduleId === "openclaw") {
    // Normalize the session key into openclaw's `agent:<agentId>:<key>` shape so
    // the native control UI routes `?session=` correctly. After resetting the
    // session we list once more so the returned record reflects the gateway
    // view (label, lastMessage preview, real updatedAt) instead of a fake
    // optimistic snapshot.
    const id = `agent:main:kuaifan-${crypto.randomUUID()}`;
    return await withOpenClawGateway(async (gateway) => {
      await gateway.resetSession(id);
      const rows = await gateway.listSessions({
        limit: 200,
        includeDerivedTitles: true,
        includeLastMessage: true,
      });
      const row = rows.find((r) => r.key === id)
        ?? rows.find((r) => typeof r.key === "string" && r.key.startsWith("agent:main:kuaifan-"));
      const raw = row?.updatedAt ? (row.updatedAt < 1e10 ? row.updatedAt * 1000 : row.updatedAt) : Date.now();
      return {
        id,
        moduleId,
        title: row?.label && row.label !== "新会话" ? row.label : "新会话",
        lastMessage: row?.lastMessage?.preview,
        updatedAt: raw,
        createdAt: raw,
      };
    });
  }

  if (moduleId === "hermes") {
    const client = clientFromGuiUrl(guiUrl);
    try {
      const session = await client.createSession();
      return {
        id: session.id,
        moduleId,
        title: session.title || "新会话",
        lastMessage: session.lastMessage,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
      };
    } finally {
      client.dispose();
    }
  }

  throw new Error(`${moduleId} 暂不支持创建会话`);
}

export async function deleteModuleSession(
  moduleId: ModuleId,
  sessionId: string,
  guiUrl?: string | null,
): Promise<void> {
  if (moduleId === "openclaw") {
    await withOpenClawGateway((gateway) => gateway.deleteSession(sessionId, true));
    return;
  }
  if (moduleId === "hermes") {
    const client = clientFromGuiUrl(guiUrl);
    try {
      await client.deleteStoredSession(sessionId);
    } finally {
      client.dispose();
    }
    return;
  }
  throw new Error(`${moduleId} 暂不支持删除会话`);
}

export async function renameModuleSession(
  moduleId: ModuleId,
  sessionId: string,
  title: string,
  guiUrl?: string | null,
): Promise<void> {
  if (moduleId === "openclaw") {
    await withOpenClawGateway((gateway) => gateway.patchSession(sessionId, { label: title }));
    return;
  }
  if (moduleId === "hermes") {
    const client = clientFromGuiUrl(guiUrl);
    try {
      await client.renameStoredSession(sessionId, title);
    } finally {
      client.dispose();
    }
    return;
  }
  throw new Error(`${moduleId} 暂不支持重命名会话`);
}
