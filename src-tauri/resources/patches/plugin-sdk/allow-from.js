export function isAllowedParsedChatSender(params) {
    const allowFrom = params.allowFrom.map((entry) => String(entry).trim());
    if (allowFrom.length === 0) {
        // Fail closed by default. Callers can opt into legacy "empty = allow all"
        // behavior explicitly when a surface intentionally treats an empty list as open.
        return params.emptyAllowFrom === "allow";
    }
    if (allowFrom.includes("*")) {
        return true;
    }
    const senderNormalized = params.normalizeSender(params.sender);
    const chatId = params.chatId ?? undefined;
    const chatGuid = params.chatGuid?.trim();
    const chatIdentifier = params.chatIdentifier?.trim();
    for (const entry of allowFrom) {
        if (!entry)
            continue;
        const parsed = params.parseAllowTarget(entry);
        if (parsed.kind === "chat_id" && chatId !== undefined) {
            if (parsed.chatId === chatId)
                return true;
        }
        else if (parsed.kind === "chat_guid" && chatGuid) {
            if (parsed.chatGuid === chatGuid)
                return true;
        }
        else if (parsed.kind === "chat_identifier" && chatIdentifier) {
            if (parsed.chatIdentifier === chatIdentifier)
                return true;
        }
        else if (parsed.kind === "handle" && senderNormalized) {
            if (parsed.handle === senderNormalized)
                return true;
        }
    }
    return false;
}
