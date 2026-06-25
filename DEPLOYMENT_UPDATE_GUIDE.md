# 快泛claw 更新服务部署指南

## 1. 服务器环境要求

- Node.js 14+  
- Express.js  
- 静态文件服务  
- 足够的存储空间用于存储更新包
- 可选：Nginx 作为反向代理（推荐）

## 2. 部署步骤

### 2.1 配置独立的更新服务

1. **克隆代码库**
   ```bash
   git clone <repository-url>
   cd ORD/update-service
   npm install
   ```

2. **配置环境变量（可选）**
   创建 `.env` 文件：
   ```env
   PORT=3001
   ```

3. **启动更新服务**
   ```bash
   npm start
   ```

   推荐使用进程管理工具（如PM2）来管理服务：
   ```bash
   npm install -g pm2
   pm2 start index.js --name "kuafan-update-service"
   pm2 save
   ```

### 2.2 配置快泛claw项目服务器

1. **准备服务器环境**
   - 安装 Node.js 14+
   - 安装必要的构建工具

2. **克隆快泛claw项目**
   ```bash
   git clone <repository-url>
   cd ORD
   ```

3. **安装依赖**
   ```bash
   # 安装前端依赖
   cd web
   npm install
   
   # 安装Tauri依赖（根据操作系统需要）
   # Windows: 需要安装 Visual Studio Build Tools
   # macOS: 需要安装 Xcode Command Line Tools
   # Linux: 需要安装相关系统依赖
   ```

4. **配置API地址**
   修改前端API配置文件 `web/src/config/api.ts`：
   ```typescript
   export const API_CONFIG = {
     baseURL: 'http://your-server-ip:5000/api', // 代理后端地址
     updateServiceBaseURL: 'http://your-server-ip:3001/api', // 更新服务地址
     // ...
   };
   ```

### 2.3 配置更新包存储

1. **更新包存储目录**
   更新服务已默认创建以下目录：
   ```
   update-service/updates/app      # 快泛claw应用更新包
   update-service/updates/openclaw  # OpenClaw-CN更新包
   ```

### 2.4 配置版本信息

1. **更新版本配置**
   编辑 `update-service/config/versionConfig.js` 文件，更新版本信息和下载链接：
   ```javascript
   module.exports = {
     app: {
       current: '1.0.1',
       history: [
         {
           version: '1.0.1',
           releaseDate: '2026-04-12',
           changelog: '\n• 新增版本更新功能\n• 修复已知问题\n• 性能优化',
           downloadUrl: 'http://your-server:3001/updates/app/kuafan-claw-1.0.1.zip'
         }
       ]
     },
     openclaw: {
       current: '1.0.0',
       history: [
         {
           version: '1.0.0',
           releaseDate: '2026-04-10',
           changelog: '\n• 初始版本发布\n• 支持多平台机器人\n• 优化网关性能',
           downloadUrl: 'http://your-server:3001/updates/openclaw/openclaw-cn-1.0.0.zip'
         }
       ]
     }
   };
   ```

## 3. 快泛claw项目迭代更新流程

### 3.1 开发新功能或修复bug

1. **在本地开发环境中进行开发**
   ```bash
   cd ORD/web
   npm run dev
   ```

2. **测试新功能**
   - 确保所有功能正常工作
   - 测试版本更新功能

### 3.2 构建新版本

1. **更新版本号**
   - 修改 `src-tauri/tauri.conf.json` 中的版本号
   - 修改 `web/package.json` 中的版本号

2. **构建前端应用**
   ```bash
   cd ORD/web
   npm run build
   ```

3. **构建Tauri应用**
   ```bash
   cd ORD/src-tauri
   npm run tauri build
   ```

4. **打包更新文件**
   - 找到构建输出目录（通常在 `src-tauri/target/release/bundle`）
   - 将构建好的应用打包为zip文件
   - 命名格式：`kuafan-claw-{version}.zip`

### 3.3 发布更新

1. **上传更新包**
   - 将zip文件上传到服务器的 `update-service/updates/app/` 目录

2. **更新版本配置**
   - 更新 `update-service/config/versionConfig.js` 中的版本信息
   - 更新下载链接指向新的更新包

3. **重启更新服务**
   ```bash
   pm2 restart kuafan-update-service
   ```

### 3.4 验证更新

1. **在客户端测试更新**
   - 打开快泛claw应用
   - 进入设置页面
   - 点击"检查新版本"按钮
   - 确认能检测到新版本
   - 测试下载和安装更新

## 4. 客户端更新流程

1. **用户打开快泛claw应用**
2. **进入设置页面**
3. **点击"检查新版本"按钮**
4. **系统检测到新版本后，显示更新提示**
5. **用户点击"下载更新"按钮**
6. **系统下载并安装更新包**
7. **提示用户重启应用以完成更新**

## 5. 自动化部署建议

### 5.1 使用CI/CD工具

1. **配置GitHub Actions或Jenkins**
   - 设置自动化构建流程
   - 自动测试
   - 自动打包
   - 自动部署到服务器

2. **配置部署脚本**
   ```bash
   # deploy.sh
   #!/bin/bash
   
   # 构建应用
   cd ORD/web
   npm run build
   
   cd ../src-tauri
   npm run tauri build
   
   # 打包更新文件
   VERSION=$(grep -oP '"version": "\K[^"]+' tauri.conf.json)
   zip -r kuafan-claw-$VERSION.zip target/release/bundle
   
   # 上传到服务器
   scp kuafan-claw-$VERSION.zip user@server:/path/to/ORD/update-service/updates/app/
   
   # 更新版本配置
   ssh user@server "sed -i 's/current: .*/current: \"$VERSION\"/' /path/to/ORD/update-service/config/versionConfig.js"
   
   # 重启更新服务
   ssh user@server "pm2 restart kuafan-update-service"
   ```

## 6. 故障排查

### 6.1 更新检查失败
- 检查更新服务是否正常运行
- 检查网络连接是否正常
- 检查版本配置文件是否正确
- 检查更新服务地址是否配置正确

### 6.2 更新下载失败
- 检查更新包是否存在于服务器
- 检查文件权限是否正确
- 检查网络连接是否稳定
- 检查服务器存储空间是否充足

### 6.3 更新安装失败
- 检查更新包是否完整
- 检查应用权限是否足够
- 检查客户端存储空间是否充足
- 检查更新包格式是否正确

## 7. 安全注意事项

- 定期备份更新包和版本配置
- 验证更新包的完整性和安全性
- 限制更新服务的访问权限
- 监控更新服务的运行状态
- 使用HTTPS协议传输更新包
- 对更新包进行数字签名验证

## 8. 最佳实践

1. **版本管理**
   - 使用语义化版本号（如 1.0.0, 1.0.1, 1.1.0）
   - 保持版本号与配置文件一致

2. **更新包管理**
   - 保留历史版本更新包
   - 设置更新包存储上限，定期清理旧版本

3. **监控与日志**
   - 记录更新检查和下载的日志
   - 监控更新服务的性能和可用性

4. **用户体验**
   - 提供清晰的更新提示和进度显示
   - 允许用户选择是否立即更新
   - 提供更新内容的详细说明

## 9. 服务隔离说明

- **update-service**：独立的更新服务，负责版本检查和更新包下载
- **agent-backend**：代理后端服务，负责邀请码验证等其他功能
- 两个服务完全隔离，互不影响
- 更新服务仅处理与版本更新相关的功能
