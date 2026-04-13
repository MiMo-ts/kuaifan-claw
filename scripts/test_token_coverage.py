"""
测试各供应商 test_model_connection 是否正确写入 token_usage.jsonl
直接通过 Tauri IPC 调用 Rust 命令
"""
import json
import subprocess
import time
import os

TAURI_EXE = r"d:\ORD\src-tauri\target\debug\openclaw-cn-manager.exe"
DATA_DIR = r"d:\ORD\src-tauri\target\debug\data"

def get_metrics_content():
    """读取当前 token_usage.jsonl 内容"""
    path = os.path.join(DATA_DIR, "metrics", "token_usage.jsonl")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def clear_metrics():
    """清空 token_usage.jsonl"""
    path = os.path.join(DATA_DIR, "metrics", "token_usage.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        f.write("")
    print(f"[CLEAR] {path}")

def invoke_tauri_cmd(cmd_name, args=None):
    """
    通过 tauri devtools CLI (tdcv) 或直接写 JSON-RPC 调用
    这里用 PowerShell 脚本模拟 Tauri IPC invoke
    """
    import urllib.request
    import urllib.error

    # Tauri IPC 通过 named pipe，不支持 HTTP
    # 所以用 PowerShell 调用 Rust 二进制方式验证
    # 这里改用直接模拟：调用 cargo test 或写 Rust 单元测试来验证
    pass

def test_via_tauri_cli():
    """通过 cargo tauri-level 方式（不可行，直接提示）"""
    print("[INFO] Tauri IPC 不支持外部 HTTP 调用，需通过 Web UI 或 Rust 测试")
    return []

def verify_code_coverage():
    """
    通过读取 model.rs 源码，验证每个分支是否都有 write_token_usage
    返回每个供应商的写入状态
    """
    model_rs = r"d:\ORD\src-tauri\src\commands\model.rs"
    with open(model_rs, encoding="utf-8") as f:
        content = f.read()

    providers = [
        "openrouter", "openai", "anthropic", "google",
        "deepseek", "minimax", "volc_ark", "nvidia",
        "aliyun", "zhipu", "moonshot", "ollama", "xiaomi"
    ]

    print("\n=== 源码覆盖验证：各供应商 test_model_connection 是否写 token_usage.jsonl ===")
    results = {}
    for prov in providers:
        # 找该供应商的 match 分支
        idx = content.find(f'"{prov}" =>')
        if idx == -1:
            results[prov] = "❌ 未找到 match 分支"
            continue

        # 截取该分支到下一个分支之间内容（约3000字符范围）
        chunk = content[idx:idx+3000]
        has_write = "write_token_usage" in chunk
        results[prov] = "✅ write_token_usage" if has_write else "❌ 未调用 write_token_usage"

    for prov, status in results.items():
        print(f"  {prov:12s}  {status}")
    return results

def main():
    print("=" * 60)
    print("Tauri IPC 无法从 Python 直接调用（需要 Web UI）")
    print("改为 1) 源码覆盖验证  2) PowerShell 写 Rust 测试")
    print("=" * 60)

    # 方案：用 cargo test 运行 model.rs 里的集成测试
    # 先清空 metrics
    clear_metrics()

    # 方案A：验证源码覆盖
    results = verify_code_coverage()

    # 打印总结
    print("\n=== 汇总 ===")
    has_issues = any("❌" in v for v in results.values())
    if has_issues:
        print("⚠️  存在未覆盖分支，请检查上方 ❌ 项")
    else:
        print("✅ 所有供应商分支均已包含 write_token_usage 调用")

    # 方案B：运行 Rust 单元测试（如果有）
    print("\n=== 运行 Rust 单元测试 ===")
    result = subprocess.run(
        ["cargo", "test", "--", "test_model", "--nocapture"],
        cwd=r"d:\ORD\src-tauri",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    print(result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout)
    if result.stderr:
        print("[STDERR]", result.stderr[-1000:])

if __name__ == "__main__":
    main()
