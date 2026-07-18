BACKGROUND_MODE = "background"
INTERACTIVE_MODE = "interactive"

BACKGROUND_SUFFIX = "::background"
INTERACTIVE_SUFFIX = "::interactive"


def normalize_mode(value: str | None) -> str:
    if value is None:
        return BACKGROUND_MODE
    normalized = value.strip().lower()
    if normalized in (BACKGROUND_MODE, INTERACTIVE_MODE):
        return normalized
    raise ValueError("browser mode must be 'background' or 'interactive'")


def background_session_key(task_id: str) -> str:
    return f"{task_id}{BACKGROUND_SUFFIX}"


def interactive_session_key(task_id: str) -> str:
    return f"{task_id}{INTERACTIVE_SUFFIX}"


def is_presentation_session_key(session_key: str) -> bool:
    return session_key.endswith((BACKGROUND_SUFFIX, INTERACTIVE_SUFFIX))


def owner_task_id(session_key: str) -> str:
    for suffix in (BACKGROUND_SUFFIX, INTERACTIVE_SUFFIX):
        if session_key.endswith(suffix):
            return session_key[: -len(suffix)]
    return session_key
