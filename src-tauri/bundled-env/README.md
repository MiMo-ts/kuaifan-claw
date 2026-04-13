# 内置离线包（Windows）

打包安装程序前，`build.rs` 会自动将下列文件下载到此目录（若已存在且体积合理则跳过）：

- `node-v22.14.0-win-x64.zip` — Node.js 官方 Windows x64 压缩包
- `MinGit-2.53.0-64-bit.zip` — Git for Windows MinGit 便携版（与官方 release 文件名一致）

二者会被列入 `tauri.conf.json` 的 `bundle.resources`，安装后随应用在资源目录中提供。  
**一键安装 Node/Git 时优先从本地解压**，无需访问外网；仅当内置文件缺失时才尝试在线下载。

若构建机无法出网，请手工将上述 zip 放到本目录后再执行 `cargo tauri build`。
