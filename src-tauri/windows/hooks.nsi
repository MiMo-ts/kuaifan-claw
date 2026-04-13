; NSIS 安装钩子 — OpenClaw-CN Manager
;
; 支持自定义安装路径（perMachine 模式）：
;   - NSIS 默认会询问用户选择安装目录（无需额外代码）
;   - exe 安装到 $INSTDIR（用户可改为 D:\、E:\ 等任意位置）
;   - data/ 目录跟随 exe（$INSTDIR\data），所有运行时数据（Node/Git/日志/配置等）均在其中
;
; 数据目录布局（$INSTDIR\data\）:
;   - config/        配置文件
;   - instances/      实例数据
;   - backups/       备份文件
;   - logs/          日志
;   - plugins/       插件
;   - robots/        机器人
;   - metrics/       指标
;   - env/           自包含 Node.js / Git（首次运行时解压内置 zip）
;   - openclaw-cn/   OpenClaw-CN 主程序 + node_modules（首次运行时安装）
;   - openclaw-state/ 运行时状态
;
; 路径引用关系（由 exe 运行时 resolve_release_data_dir 决定）:
;   - 环境变量 OPENCLAW_CN_DATA_DIR 最高优先级
;   - 默认：{exe_dir}/data（安装程序预先创建，无需便携标记文件）

!macro CUSTOM_INSTALL
  ; ── 在用户选择的 $INSTDIR 下创建 data 子目录 ──────────────────────────
  ; exe 运行时会直接使用 $INSTDIR\data 作为数据根目录（resolve_release_data_dir 默认行为），
  ; 预先创建可确保首次运行时代码直接使用，无需触发目录创建逻辑。

  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\config"
  CreateDirectory "$INSTDIR\data\instances"
  CreateDirectory "$INSTDIR\data\backups"
  CreateDirectory "$INSTDIR\data\logs"
  CreateDirectory "$INSTDIR\data\plugins"
  CreateDirectory "$INSTDIR\data\robots"
  CreateDirectory "$INSTDIR\data\metrics"
  CreateDirectory "$INSTDIR\data\env"
  CreateDirectory "$INSTDIR\data\openclaw-cn"
  CreateDirectory "$INSTDIR\data\openclaw-state"
  ; Program Files 默认仅管理员可写：普通用户无法写 data\logs → 应用 init_logging panic 且无界面。
  ; *S-1-5-32-545 = Users（各语言 Windows 通用），(OI)(CI)M = 子项继承修改权限。
  ExecWait 'cmd.exe /c icacls "$INSTDIR\data" /grant *S-1-5-32-545:(OI)(CI)M /T' $0
!macroend

!macro CUSTOM_INSTALL_MODE
  ; perMachine 模式：用户可自由选择安装目录（默认指向 C:\Program Files\OpenClaw-CN Manager，
  ; 用户可改为 D:\OpenClaw-CN、E:\Apps\openclaw 等任意位置）
  ; NSIS 默认弹出目录选择对话框（"选择安装位置"）
  ; 安装程序会检查目标路径是否可写（如 D:\ 等普通目录可写， C:\Windows 则拒绝）
!macroend
