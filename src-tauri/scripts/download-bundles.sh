#!/usr/bin/env bash
# =============================================================================
# download-bundles.sh  鈥? OpenClaw-CN Manager  macOS / Linux 璧勬簮涓嬭浇鑴氭湰
# 鐢ㄦ硶锛?#   ./download-bundles.sh          # 涓嬭浇鍏ㄩ儴
#   ./download-bundles.sh -f       # 寮哄埗閲嶆柊涓嬭浇
#   ./download-bundles.sh -p       # 浠呬笅杞介€氶亾鎻掍欢
# =============================================================================

set -euo pipefail

FORCE=false
PLUGINS_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--force)       FORCE=true ;;
        -p|--plugins-only) PLUGINS_ONLY=true ;;
        *) echo "鏈煡鍙傛暟: $1"; exit 1 ;;
    esac
    shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TAURI="$REPO_ROOT/src-tauri"

# 鈹€鈹€ 棰滆壊 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; DIM='\033[2m'; RESET='\033[0m'

step()  { echo -e "\n${CYAN}[涓嬭浇]${RESET} $1"; }
ok()    { echo -e "${GREEN}[  OK  ]${RESET} $1"; }
skip()  { echo -e "${DIM}[璺宠繃]${RESET} $1"; }
fail()  { echo -e "${RED}[閿欒]${RESET} $1"; exit 1; }
info()  { echo -e "        ${DIM}$1${RESET}"; }

# 鈹€鈹€ 妫€娴嬫灦鏋?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
detect_arch() {
    case "$(uname -m)" in
        arm64|aarch64) echo "arm64" ;;
        *)             echo "x64"   ;;
    esac
}

ARCH="$(detect_arch)"
step "鐜棰勬 鈥?macOS $(uname -m), arch=$ARCH"

# 鈹€鈹€ 妫€娴?npm 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if command -v npm &>/dev/null; then
    info "Node.js $(node --version) / npm $(npm --version)"
else
    fail "npm 涓嶅彲鐢ㄣ€傝瀹夎 Node.js锛堝缓璁?v18+锛夛細https://nodejs.org"
fi

# 鈹€鈹€ 涓嬭浇杈呭姪鍑芥暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
ensure_dir() { mkdir -p "$(dirname "$1")"; }

file_sufficient() {
    [[ -f "$1" ]] && [[ $(wc -c < "$1") -ge $2 ]]
}

fmt_size() {
    local bytes=$1
    if   (( bytes >= 1048576 )); then printf "%.1f MB"  "$(echo "scale=1; $bytes/1048576" | bc)"
    elif (( bytes >= 1024     )); then printf "%.0f KB"  "$(echo "scale=0; $bytes/1024"    | bc)"
    else                               printf "%d B"    "$bytes"
    fi
}

# Download-File <url> <dest> <label> <min_bytes>
download_file() {
    local url=$1 dest=$2 label=$3 min_bytes=$4

    if [[ "$FORCE" != true ]] && file_sufficient "$dest" "$min_bytes"; then
        skip "$label 宸插氨缁?($(fmt_size $(wc -c < "$dest")))"
        return 0
    fi

    ensure_dir "$dest"

    local fallback=""
    if [[ "$url" == *"npmmirror"* ]]; then
        fallback="${url//npmmirror.com\/mirrors\/node/npmjs.org\/dist}"
    fi

    for src in "$url" "$fallback"; do
        [[ -z "$src" ]] && continue
        info "灏濊瘯: $src"
        if curl -fSL --connect-timeout 30 --max-time 600 \
                -o "$dest" "$src" 2>/dev/null; then
            if file_sufficient "$dest" "$min_bytes"; then
                ok "$label 涓嬭浇瀹屾垚 ($(fmt_size $(wc -c < "$dest")))"
                return 0
            fi
            info "$label 鏂囦欢杩囧皬锛屽皾璇曚笅涓€涓簮"
            rm -f "$dest"
        else
            info "涓嬭浇澶辫触"
        fi
    done

    fail "$label 涓嬭浇澶辫触锛堟墍鏈夋簮鍧囦笉鍙揪锛岃妫€鏌ョ綉缁滐級"
}

# Npm-Pack <pkg> <dest> <label> <min_bytes>
npm_pack() {
    local pkg=$1 dest=$2 label=$3 min_bytes=$4

    if [[ "$FORCE" != true ]] && file_sufficient "$dest" "$min_bytes"; then
        skip "$label 宸插氨缁?($(fmt_size $(wc -c < "$dest")))"
        return 0
    fi

    ensure_dir "$dest"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap "rm -rf '$tmp_dir'" EXIT

    local registries=("https://registry.npmmirror.com" "https://registry.npmjs.org")
    local done=false

    for reg in "${registries[@]}"; do
        info "npm pack $pkg @ $reg"
        if npm pack "$pkg" --registry "$reg" --pack-destination "$tmp_dir" &>/dev/null; then
            local tgz
            tgz=$(ls "$tmp_dir"/*.tgz 2>/dev/null | head -1)
            if [[ -n "$tgz" ]]; then
                local size
                size=$(wc -c < "$tgz")
                if (( size >= min_bytes )); then
                    mv "$tgz" "$dest"
                    ok "$label 涓嬭浇瀹屾垚 ($(fmt_size $size)) 鈫?$reg"
                    done=true
                    break
                else
                    info "tgz 杩囧皬 ($(fmt_size $size))锛屽皾璇曚笅涓€涓?registry"
                    rm -f "$tgz"
                fi
            fi
        fi
    done

    if [[ "$done" != true ]]; then
        fail "$label 涓嬭浇澶辫触锛堟墍鏈?npm registry 鍧囦笉鍙揪锛?
    fi
}

# 鈹€鈹€ 闃舵 A锛氬唴缃幆澧冨寘 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
if [[ "$PLUGINS_ONLY" != true ]]; then

    step "涓嬭浇鍐呯疆鐜鍖?鈥?arch=$ARCH"

    # A1. Node.js锛?tar.gz锛宮acOS 涓撶敤锛?    case "$ARCH" in
        arm64)
            NODE_FILE="node-v22.14.0-darwin-arm64.tar.gz"
            NODE_URL="https://npmmirror.com/mirrors/node/v22.14.0/$NODE_FILE" ;;
        x64)
            NODE_FILE="node-v22.14.0-darwin-x64.tar.gz"
            NODE_URL="https://npmmirror.com/mirrors/node/v22.14.0/$NODE_FILE" ;;
    esac
    NODE_DEST="$SRC_TAURI/bundled-env/$NODE_FILE"
    download_file "$NODE_URL" "$NODE_DEST" "Node.js v22.14.0 (darwin-$ARCH)" $((5 * 1024 * 1024))

    # A2. MinGit 鈥?macOS 閫氬父鏈夌郴缁?git锛岃剼鏈細妫€娴嬫槸鍚﹀凡鏈?git
    #     鑻?CI 闇€瑕侊紝鍙敤 git-for-windows 鐨?PortableGit tar.gz
    if command -v git &>/dev/null; then
        skip "Git 宸插畨瑁?($(git --version))锛岃烦杩?MinGit 涓嬭浇"
    else
        case "$ARCH" in
            arm64)
                GIT_FILE="mingit-2.53.0-arm64.tar.gz"
                GIT_URL="https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.1/$GIT_FILE" ;;
            x64)
                GIT_FILE="mingit-2.53.0-intel.tar.gz"
                GIT_URL="https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.1/$GIT_FILE" ;;
        esac
        GIT_DEST="$SRC_TAURI/bundled-env/$GIT_FILE"
        if curl -fSL --connect-timeout 10 -o /dev/null -s "$GIT_URL" 2>/dev/null; then
            download_file "$GIT_URL" "$GIT_DEST" "MinGit 2.53.0 (darwin-$ARCH)" $((10 * 1024 * 1024))
        else
            skip "MinGit tar.gz 涓嶅彲杈撅紝璺宠繃锛堝彲鑷瀹夎 git 鎴栭厤缃?PATH锛?
        fi
    fi

    # A3. openclaw-cn
    step "涓嬭浇 openclaw-cn npm 鍖咃紙npm pack锛屽彲鑳介渶瑕?1~5 鍒嗛挓锛?
    OC_DEST="$SRC_TAURI/bundled-openclaw/openclaw-cn.tgz"
    npm_pack "openclaw-cn" "$OC_DEST" "openclaw-cn" $((1 * 1024 * 1024))

fi

# 鈹€鈹€ 闃舵 B锛氶€氶亾鎻掍欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
step "涓嬭浇閫氶亾鎻掍欢 tgz"

declare -A CHANNEL_PLUGINS=(
    ["wxwork"]="@wecom/wecom-openclaw-plugin"
    ["qq"]="@sliverp/qqbot"
    ["wechat_clawbot"]="@tencent-weixin/openclaw-weixin"
    ["telegram"]="@clawdbot/telegram"
)

for plugin_id in "${!CHANNEL_PLUGINS[@]}"; do
    pkg="${CHANNEL_PLUGINS[$plugin_id]}"
    dest="$SRC_TAURI/resources/plugins/${plugin_id}.tgz"
    npm_pack "$pkg" "$dest" "鎻掍欢 ${plugin_id}" $((10 * 1024))
done

# 鈹€鈹€ 闃舵 C锛氬啓鍏?.resource_version 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
step "鏇存柊 .resource_version"
CARGO_TOML="$SRC_TAURI/Cargo.toml"
VER_FILE="$SRC_TAURI/resources/data/.resource_version"

if [[ -f "$CARGO_TOML" ]]; then
    version=$(grep '^\s*version\s*=' "$CARGO_TOML" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
    if [[ -n "$version" ]]; then
        if [[ -f "$VER_FILE" ]]; then
            current=$(cat "$VER_FILE" | tr -d '[:space:]')
        else
            current=""
        fi
        if [[ "$current" != "$version" ]]; then
            echo "$version" > "$VER_FILE"
            ok ".resource_version 宸叉洿鏂颁负 v$version"
        else
            skip ".resource_version 宸叉槸鏈€鏂?(v$version)"
        fi
    fi
fi

# 鈹€鈹€ 瀹屾垚 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
echo ""
echo -e "${GREEN}============================================================${RESET}"
echo -e "${GREEN}  涓嬭浇瀹屾垚锛?{RESET}"
echo -e "${GREEN}============================================================${RESET}"
echo ""
echo -e "  涓嬩竴姝?鈥?杩愯鏋勫缓锛?
echo ""
echo -e "    姝ｅ紡鎵撳寘锛坮elease锛夛細${DIM}cd src-tauri && cargo tauri build${RESET}"
echo -e "    寮€鍙戣皟璇曪紙debug锛夛細  ${DIM}cd src-tauri && cargo build${RESET}"
echo ""
echo -e "    閲嶆柊涓嬭浇锛堣鐩栧凡鏈夋枃浠讹級锛?{DIM}./download-bundles.sh -f${RESET}"
echo ""
