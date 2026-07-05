// PATCHED-BY-KUAIFANCLAW: hook-runtime sub-module (missing from upstream dist)
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
export function fireAndForgetHook(hookName, ctx) {
    const runner = getGlobalHookRunner();
    if (!runner) return;
    try { runner.fireAndForget(hookName, ctx); } catch {}
}
export function buildCanonicalSentMessageHookContext(params) {
    return {
        channel: params.channel ?? "openclaw-weixin",
        accountId: params.accountId, messageId: params.messageId,
        chatType: params.chatType, peerId: params.peerId,
        text: params.text, mediaUrls: params.mediaUrls ?? [],
    };
}
export function toPluginMessageContext(ctx) {
    return {
        channel: ctx.channel, accountId: ctx.accountId,
        messageId: ctx.messageId, chatType: ctx.chatType,
        peerId: ctx.peerId, text: ctx.text,
        mediaUrls: ctx.mediaUrls ?? [],
    };
}
export function toPluginMessageSentEvent(ctx) {
    return {
        channel: ctx.channel, accountId: ctx.accountId,
        messageId: ctx.messageId, chatType: ctx.chatType,
        peerId: ctx.peerId, text: ctx.text, timestamp: Date.now(),
    };
}
