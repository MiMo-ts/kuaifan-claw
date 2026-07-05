import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const POSIX_OPENCLAW_TMP_DIR = "/tmp/openclaw";
function isNodeErrorWithCode(err, code) {
    return (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === code);
}
export function resolvePreferredOpenClawTmpDir(options = {}) {
    const accessSync = options.accessSync ?? fs.accessSync;
    const lstatSync = options.lstatSync ?? fs.lstatSync;
    const mkdirSync = options.mkdirSync ?? fs.mkdirSync;
    const getuid = options.getuid ??
        (() => {
            try {
                return typeof process.getuid === "function" ? process.getuid() : undefined;
            }
            catch {
                return undefined;
            }
        });
    const tmpdir = options.tmpdir ?? os.tmpdir;
    const uid = getuid();
    const isSecureDirForUser = (st) => {
        if (uid === undefined) {
            return true;
        }
        if (typeof st.uid === "number" && st.uid !== uid) {
            return false;
        }
        // Avoid group/other writable dirs when running on multi-user hosts.
        if (typeof st.mode === "number" && (st.mode & 0o022) !== 0) {
            return false;
        }
        return true;
    };
    const fallback = () => {
        const base = tmpdir();
        const suffix = uid === undefined ? "openclaw" : `openclaw-${uid}`;
        return path.join(base, suffix);
    };
    try {
        const preferred = lstatSync(POSIX_OPENCLAW_TMP_DIR);
        if (!preferred.isDirectory() || preferred.isSymbolicLink()) {
            return fallback();
        }
        accessSync(POSIX_OPENCLAW_TMP_DIR, fs.constants.W_OK | fs.constants.X_OK);
        if (!isSecureDirForUser(preferred)) {
            return fallback();
        }
        return POSIX_OPENCLAW_TMP_DIR;
    }
    catch (err) {
        if (!isNodeErrorWithCode(err, "ENOENT")) {
            return fallback();
        }
    }
    try {
        accessSync("/tmp", fs.constants.W_OK | fs.constants.X_OK);
        // Create with a safe default; subsequent callers expect it exists.
        mkdirSync(POSIX_OPENCLAW_TMP_DIR, { recursive: true, mode: 0o700 });
        try {
            const preferred = lstatSync(POSIX_OPENCLAW_TMP_DIR);
            if (!preferred.isDirectory() || preferred.isSymbolicLink()) {
                return fallback();
            }
            if (!isSecureDirForUser(preferred)) {
                return fallback();
            }
        }
        catch {
            return fallback();
        }
        return POSIX_OPENCLAW_TMP_DIR;
    }
    catch {
        return fallback();
    }
}
