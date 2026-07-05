export { CHANNEL_MESSAGE_ACTION_NAMES } from "../channels/plugins/message-action-names.js";
export { BLUEBUBBLES_ACTIONS, BLUEBUBBLES_ACTION_NAMES, BLUEBUBBLES_GROUP_ACTIONS, } from "../channels/plugins/bluebubbles-actions.js";
export { normalizePluginHttpPath } from "../plugins/http-path.js";
export { registerPluginHttpRoute } from "../plugins/http-registry.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export { getChatChannelMeta } from "../channels/registry.js";
export { DiscordConfigSchema, GoogleChatConfigSchema, IMessageConfigSchema, MSTeamsConfigSchema, SignalConfigSchema, SlackConfigSchema, TelegramConfigSchema, } from "../config/zod-schema.providers-core.js";
export { WhatsAppConfigSchema } from "../config/zod-schema.providers-whatsapp.js";
export { BlockStreamingCoalesceSchema, DmConfigSchema, DmPolicySchema, GroupPolicySchema, MarkdownConfigSchema, MarkdownTableModeSchema, normalizeAllowFrom, requireOpenAllowFrom, } from "../config/zod-schema.core.js";
export { ToolPolicySchema } from "../config/zod-schema.agent-runtime.js";
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
export { resolveAckReaction } from "../agents/identity.js";
export { SILENT_REPLY_TOKEN, isSilentReplyText } from "../auto-reply/tokens.js";
export { buildPendingHistoryContextFromMap, clearHistoryEntries, clearHistoryEntriesIfEnabled, DEFAULT_GROUP_HISTORY_LIMIT, recordPendingHistoryEntry, recordPendingHistoryEntryIfEnabled, } from "../auto-reply/reply/history.js";
export { mergeAllowlist, summarizeMapping } from "../channels/allowlists/resolve-utils.js";
export { resolveMentionGating, resolveMentionGatingWithBypass, } from "../channels/mention-gating.js";
export { removeAckReactionAfterReply, shouldAckReaction, shouldAckReactionForWhatsApp, } from "../channels/ack-reactions.js";
export { createTypingCallbacks } from "../channels/typing.js";
export { createReplyPrefixContext, createReplyPrefixOptions } from "../channels/reply-prefix.js";
export { logAckFailure, logInboundDrop, logTypingFailure } from "../channels/logging.js";
export { resolveChannelMediaMaxBytes } from "../channels/plugins/media-limits.js";
export { formatLocationText, toLocationContext } from "../channels/location.js";
export { resolveControlCommandGate } from "../channels/command-gating.js";
export { resolveBlueBubblesGroupRequireMention, resolveDiscordGroupRequireMention, resolveGoogleChatGroupRequireMention, resolveIMessageGroupRequireMention, resolveSlackGroupRequireMention, resolveTelegramGroupRequireMention, resolveWhatsAppGroupRequireMention, resolveBlueBubblesGroupToolPolicy, resolveDiscordGroupToolPolicy, resolveGoogleChatGroupToolPolicy, resolveIMessageGroupToolPolicy, resolveSlackGroupToolPolicy, resolveTelegramGroupToolPolicy, resolveWhatsAppGroupToolPolicy, } from "../channels/plugins/group-mentions.js";
export { recordInboundSession } from "../channels/session.js";
export { buildChannelKeyCandidates, normalizeChannelSlug, resolveChannelEntryMatch, resolveChannelEntryMatchWithFallback, resolveNestedAllowlistDecision, } from "../channels/plugins/channel-config.js";
export { listDiscordDirectoryGroupsFromConfig, listDiscordDirectoryPeersFromConfig, listSlackDirectoryGroupsFromConfig, listSlackDirectoryPeersFromConfig, listTelegramDirectoryGroupsFromConfig, listTelegramDirectoryPeersFromConfig, listWhatsAppDirectoryGroupsFromConfig, listWhatsAppDirectoryPeersFromConfig, } from "../channels/plugins/directory-config.js";
export { formatAllowlistMatchMeta } from "../channels/plugins/allowlist-match.js";
export { optionalStringEnum, stringEnum } from "../agents/schema/typebox.js";
export { buildChannelConfigSchema } from "../channels/plugins/config-schema.js";
export { deleteAccountFromConfigSection, setAccountEnabledInConfigSection, } from "../channels/plugins/config-helpers.js";
export { applyAccountNameToChannelSection, migrateBaseNameToDefaultAccount, } from "../channels/plugins/setup-helpers.js";
export { formatPairingApproveHint } from "../channels/plugins/helpers.js";
export { PAIRING_APPROVED_MESSAGE } from "../channels/plugins/pairing-message.js";
export { addWildcardAllowFrom, promptAccountId } from "../channels/plugins/onboarding/helpers.js";
export { promptChannelAccessConfig } from "../channels/plugins/onboarding/channel-access.js";
export { createActionGate, jsonResult, readNumberParam, readReactionParams, readStringParam, } from "../agents/tools/common.js";
export { formatDocsLink } from "../terminal/links.js";
export { normalizeE164 } from "../utils.js";
export { missingTargetError } from "../infra/outbound/target-errors.js";
export { registerLogTransport } from "../logging/logger.js";
export { emitDiagnosticEvent, isDiagnosticsEnabled, onDiagnosticEvent, } from "../infra/diagnostic-events.js";
export { detectMime, extensionForMime, getFileExtension } from "../media/mime.js";
export { extractOriginalFilename } from "../media/store.js";
export { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
// Channel: Discord
export { listDiscordAccountIds, resolveDefaultDiscordAccountId, resolveDiscordAccount, } from "../discord/accounts.js";
export { collectDiscordAuditChannelIds } from "../discord/audit.js";
export { discordOnboardingAdapter } from "../channels/plugins/onboarding/discord.js";
export { looksLikeDiscordTargetId, normalizeDiscordMessagingTarget, } from "../channels/plugins/normalize/discord.js";
export { collectDiscordStatusIssues } from "../channels/plugins/status-issues/discord.js";
// Channel: iMessage
export { listIMessageAccountIds, resolveDefaultIMessageAccountId, resolveIMessageAccount, } from "../imessage/accounts.js";
export { imessageOnboardingAdapter } from "../channels/plugins/onboarding/imessage.js";
export { looksLikeIMessageTargetId, normalizeIMessageMessagingTarget, } from "../channels/plugins/normalize/imessage.js";
// Channel: Slack
export { listEnabledSlackAccounts, listSlackAccountIds, resolveDefaultSlackAccountId, resolveSlackAccount, resolveSlackReplyToMode, } from "../slack/accounts.js";
export { slackOnboardingAdapter } from "../channels/plugins/onboarding/slack.js";
export { looksLikeSlackTargetId, normalizeSlackMessagingTarget, } from "../channels/plugins/normalize/slack.js";
export { buildSlackThreadingToolContext } from "../slack/threading-tool-context.js";
// Channel: Telegram
export { listTelegramAccountIds, resolveDefaultTelegramAccountId, resolveTelegramAccount, } from "../telegram/accounts.js";
export { telegramOnboardingAdapter } from "../channels/plugins/onboarding/telegram.js";
export { looksLikeTelegramTargetId, normalizeTelegramMessagingTarget, } from "../channels/plugins/normalize/telegram.js";
export { collectTelegramStatusIssues } from "../channels/plugins/status-issues/telegram.js";
// Channel: Signal
export { listSignalAccountIds, resolveDefaultSignalAccountId, resolveSignalAccount, } from "../signal/accounts.js";
export { signalOnboardingAdapter } from "../channels/plugins/onboarding/signal.js";
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget, } from "../channels/plugins/normalize/signal.js";
// Channel: WhatsApp
export { listWhatsAppAccountIds, resolveDefaultWhatsAppAccountId, resolveWhatsAppAccount, } from "../web/accounts.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "../whatsapp/normalize.js";
export { whatsappOnboardingAdapter } from "../channels/plugins/onboarding/whatsapp.js";
export { resolveWhatsAppHeartbeatRecipients } from "../channels/plugins/whatsapp-heartbeat.js";
export { looksLikeWhatsAppTargetId, normalizeWhatsAppMessagingTarget, } from "../channels/plugins/normalize/whatsapp.js";
export { collectWhatsAppStatusIssues } from "../channels/plugins/status-issues/whatsapp.js";
// Channel: BlueBubbles
export { collectBlueBubblesStatusIssues } from "../channels/plugins/status-issues/bluebubbles.js";
// Channel: LINE
export { listLineAccountIds, normalizeAccountId as normalizeLineAccountId, resolveDefaultLineAccountId, resolveLineAccount, } from "../line/accounts.js";
export { LineConfigSchema } from "../line/config-schema.js";
export { createInfoCard, createListCard, createImageCard, createActionCard, createReceiptCard, } from "../line/flex-templates.js";
export { processLineMessage, hasMarkdownToConvert, stripMarkdown, } from "../line/markdown-to-line.js";
export { listFeishuAccountIds, resolveDefaultFeishuAccountId, resolveFeishuAccount, } from "../feishu/accounts.js";
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
// feishuOutbound re-export fixed by openclaw-cn-manager
export { feishuOutbound } from "../channels/plugins/outbound/feishu.js";
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
// normalizeFeishuTarget re-export fixed by openclaw-cn-manager
export { normalizeFeishuTarget } from "../channels/plugins/normalize/feishu.js";
export { probeFeishu } from "../feishu/probe.js";
export { monitorFeishuProvider } from "../feishu/monitor.js";
// Media utilities
export { loadWebMedia } from "../web/media.js";
// Command authorization helpers used by external channel plugins (e.g. official Feishu plugin)
export { resolveCommandAuthorizedFromAuthorizers } from "../channels/command-gating.js";
export { shouldComputeCommandAuthorized } from "../auto-reply/command-detection.js";
/**
 * Check whether a sender ID is in a normalized allowFrom list.
 * Strips optional "feishu:" / "user:" / "open_id:" prefixes before comparison.
 */
export function isNormalizedSenderAllowed(params) {
    const { senderId, allowFrom } = params;
    if (!senderId || !allowFrom.length)
        return false;
    const normalized = senderId.trim().toLowerCase();
    return allowFrom.some((entry) => {
        const e = String(entry)
            .trim()
            .toLowerCase()
            .replace(/^(feishu|user|open_id):/i, "");
        return e === "*" || e === normalized;
    });
}
/**
 * Resolve whether a sender is authorized to run commands.
 * Used by external channel plugins that need unified DM/group command gating.
 */
export async function resolveSenderCommandAuthorization(params) {
    const { rawBody, cfg, isGroup, dmPolicy, configuredAllowFrom, configuredGroupAllowFrom, senderId, isSenderAllowed: checkSender, readAllowFromStore, shouldComputeCommandAuthorized: shouldCompute, resolveCommandAuthorizedFromAuthorizers: resolveAuthorized, } = params;
    if (!shouldCompute(rawBody, cfg)) {
        return { commandAuthorized: true };
    }
    const storeAllowFrom = await readAllowFromStore().catch(() => []);
    if (isGroup) {
        const groupAllowFrom = configuredGroupAllowFrom ?? configuredAllowFrom;
        const hasWildcard = groupAllowFrom.some((e) => String(e).trim() === "*");
        const configured = groupAllowFrom.length > 0;
        const allowed = hasWildcard || checkSender(senderId, [...groupAllowFrom, ...storeAllowFrom]);
        const commandAuthorized = resolveAuthorized({
            useAccessGroups: configured,
            authorizers: [{ configured, allowed }],
        });
        return { commandAuthorized };
    }
    // DM
    if (dmPolicy === "open")
        return { commandAuthorized: true };
    const dmAllowFrom = [...configuredAllowFrom, ...storeAllowFrom];
    const configured = dmAllowFrom.length > 0;
    const allowed = checkSender(senderId, dmAllowFrom);
    const commandAuthorized = resolveAuthorized({
        useAccessGroups: configured,
        authorizers: [{ configured, allowed }],
    });
    return { commandAuthorized };
}
/**
 * Like `resolveSenderCommandAuthorization` but accepts a `runtime` object
 * (the `commands` slice from `PluginRuntime["channel"]`) instead of explicit
 * `shouldComputeCommandAuthorized` / `resolveCommandAuthorizedFromAuthorizers` callbacks.
 * Also returns `senderAllowedForCommands` so callers can use it for DM gating.
 */
export async function resolveSenderCommandAuthorizationWithRuntime(params) {
    const { rawBody, cfg, isGroup, dmPolicy, configuredAllowFrom, configuredGroupAllowFrom, senderId, isSenderAllowed: checkSender, readAllowFromStore, runtime, } = params;
    if (!runtime.shouldComputeCommandAuthorized(rawBody, cfg)) {
        return { senderAllowedForCommands: true, commandAuthorized: true };
    }
    const storeAllowFrom = await readAllowFromStore().catch(() => []);
    if (isGroup) {
        const groupAllowFrom = configuredGroupAllowFrom ?? configuredAllowFrom;
        const hasWildcard = groupAllowFrom.some((e) => String(e).trim() === "*");
        const configured = groupAllowFrom.length > 0;
        const allowed = hasWildcard || checkSender(senderId, [...groupAllowFrom, ...storeAllowFrom]);
        const commandAuthorized = runtime.resolveCommandAuthorizedFromAuthorizers({
            useAccessGroups: configured,
            authorizers: [{ configured, allowed }],
        });
        return { senderAllowedForCommands: allowed, commandAuthorized };
    }
    // DM
    if (dmPolicy === "open")
        return { senderAllowedForCommands: true, commandAuthorized: true };
    const dmAllowFrom = [...configuredAllowFrom, ...storeAllowFrom];
    const configured = dmAllowFrom.length > 0;
    const allowed = checkSender(senderId, dmAllowFrom);
    const commandAuthorized = runtime.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: configured,
        authorizers: [{ configured, allowed }],
    });
    return { senderAllowedForCommands: allowed, commandAuthorized };
}
/**
 * Determine the DM authorization outcome based on policy and sender permission.
 * Returns "authorized", "disabled", or "unauthorized".
 */
export function resolveDirectDmAuthorizationOutcome(params) {
    const { isGroup, dmPolicy, senderAllowedForCommands } = params;
    if (isGroup)
        return "authorized";
    if (dmPolicy === "disabled")
        return "disabled";
    if (dmPolicy === "open")
        return "authorized";
    if (senderAllowedForCommands)
        return "authorized";
    return "unauthorized";
}