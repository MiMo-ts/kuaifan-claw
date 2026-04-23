# 自动更新架构与待修复问题

## 一、当前架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Releases                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  v1.0.37.exe │  │  v1.0.36.exe │  │  v1.0.35.exe │          │
│  │  .sig        │  │  .sig        │  │  .sig (空)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                          ▲
                          │ check() → update-latest.json
                          │
┌─────────────────────────────────────────────────────────────────┐
│                      已安装的客户端 (v1.0.36)                     │
│                                                                  │
│  check() → 从 endpoints 获取 update-latest.json                  │
│           ↓                                                      │
│  比较版本号 (当前版本 vs JSON中的版本)                            │
│           ↓                                                      │
│  下载 exe + signature                                            │
│           ↓                                                      │
│  用 pubkey 验证 signature                                         │
│           ↓                                                      │
│  安装 + 重启                                                      │
└─────────────────────────────────────────────────────────────────┘
```

## 二、tauri.conf.json 配置

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEM3MjFGMzVEQzJFQzdFOEEK...",
      "endpoints": [
        "https://raw.githubusercontent.com/MiMo-ts/kuaifan-claw/main/update-latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

## 三、update-latest.json 格式

```json
{
  "version": "1.0.37",
  "notes": "快泛claw v1.0.37 发布",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://github.com/MiMo-ts/kuaifan-claw/releases/download/v1.0.37/claw_1.0.37_x64-setup.exe"
    }
  }
}
```

## 四、问题：signature 为空

### 问题原因

1. Workflow 中签名步骤发生在创建 update-latest.json **之后**
2. 创建 JSON 时，.sig 文件尚未生成
3. 所以 signature 字段为空

### 当前流程（有问题）

```
构建完成 → 上传 exe 到 release → 创建 JSON → 签名（太晚）
                                              ↓
                                         signature 为空
```

### 正确流程

```
构建完成 → 签名 exe → 上传 exe + .sig 到 release → 创建 JSON（含 signature）
```

## 五、修复方案

### 方案：修改 workflow 顺序

1. 构建完成后，先进行签名
2. 上传 exe 和 .sig 到 release
3. 最后创建 update-latest.json（此时可获取真实 signature）

### 需要修改的 workflow 步骤

```yaml
# 当前顺序（有bug）：
- Build Tauri app
- Find exe file
- Upload exe and signature to release  ← 此时 .sig 刚生成
- Create update JSON                    ← 签名还没上传，无法获取

# 修改后：
- Build Tauri app
- Find exe file
- Sign the exe (使用私钥签名)
- Upload exe and signature to release
- Create update JSON (可获取真实的 signature)
```

### 签名命令（需添加到 workflow）

```yaml
- name: Sign exe
  shell: pwsh
  run: |
    $exe = Get-ChildItem src-tauri/target/release/bundle/nsis/*.exe | Select-Object -First 1
    $sig = "$($exe.FullName).sig"
    # 使用私钥对 exe 进行签名，生成 .sig 文件
    # 需要 TAURI_SIGNING_PRIVATE_KEY 环境变量
```

## 六、Tauri Updater 工作原理

| 步骤 | 说明 |
|------|------|
| 1. check() | 调用 updater plugin，从 endpoints 获取 JSON |
| 2. 解析 JSON | 提取 version、url、signature |
| 3. 下载 exe | 从 url 下载安装包 |
| 4. 验证签名 | 用 pubkey 解密 signature，比对 exe hash |
| 5. 安装 | 验证通过后，执行安装程序 |
| 6. 重启 | 安装完成后重启应用 |

## 七、后续实现步骤

- [ ] 修改 .github/workflows/release.yml 中的签名步骤顺序
- [ ] 确保签名命令正确生成 .sig 文件
- [ ] 验证 signature 字段不为空
- [ ] 测试已安装客户端能否检测到新版本
- [ ] 测试下载安装流程是否正常

## 八、参考链接

- Tauri Updater Plugin: https://tauri.app/develop/distribute/updater/
- minisign (签名工具): https://github.com/jedisct1/minisign