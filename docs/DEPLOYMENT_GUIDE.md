# 代理后台部署指南

本指南将帮助你将代理后台部署到公网服务器，实现跨设备的邀请码验证功能。

## 前置条件

- 一台公网服务器（阿里云、腾讯云、AWS 等）
- 服务器操作系统：Linux（推荐 Ubuntu 20.04+）或 Windows
- 域名（可选，但推荐）
- MongoDB 数据库（可以使用云数据库或自建）

## 一、服务器环境准备

### 1.1 安装 Node.js

**Linux (Ubuntu):**
```bash
# 更新软件包
sudo apt update

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v
npm -v
```

**Windows:**
- 从 [nodejs.org](https://nodejs.org/) 下载 Node.js 20.x 安装包
- 运行安装程序，按照提示完成安装

### 1.2 安装 MongoDB

**选项 A：使用云数据库（推荐）**
- 阿里云 MongoDB：https://www.aliyun.com/product/mongodb
- 腾讯云 MongoDB：https://cloud.tencent.com/product/mongodb
- MongoDB Atlas：https://www.mongodb.com/atlas

**选项 B：自建数据库（Linux）**
```bash
# 安装 MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

# 启动 MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

## 二、部署代理后台

### 2.1 上传代码到服务器

```bash
# 使用 SCP 或 SFTP 上传 agent-backend 目录到服务器
# 或者使用 Git 克隆仓库
```

### 2.2 配置环境变量

在服务器上的 `agent-backend/backend/.env` 文件中配置：

```env
# MongoDB 连接字符串
# 如果使用云数据库，替换为你的云数据库连接字符串
MONGO_URI=mongodb://localhost:27017/agent-backend

# 服务器端口
PORT=5000

# JWT 密钥（生产环境请使用强密钥）
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# 邀请码加密密钥（生产环境请使用强密钥）
INVITE_CODE_SECRET=your-super-secret-invite-code-key-change-this-in-production
```

### 2.3 安装依赖并启动

```bash
cd agent-backend/backend

# 安装依赖
npm install

# 初始化数据库（首次部署）
cd ../scripts
node init-db.js

# 启动服务
cd ../backend

# 开发模式
npm start

# 生产模式（使用 PM2）
npm install -g pm2
pm2 start index.js --name agent-backend
pm2 save
pm2 startup
```

## 三、配置 Nginx 反向代理（推荐）

### 3.1 安装 Nginx

```bash
sudo apt install nginx
```

### 3.2 配置 Nginx

创建配置文件 `/etc/nginx/sites-available/agent-backend`：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或服务器IP

    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/agent-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3.3 配置 SSL（HTTPS，推荐）

使用 Let's Encrypt 免费证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 四、配置前端

### 4.1 修改 API 地址

修改 `web/src/config/api.ts` 文件：

```typescript
export const API_CONFIG = {
  // 修改为你的服务器地址
  // 示例：
  // baseURL: 'https://your-domain.com/api',
  // 或
  // baseURL: 'http://your-server-ip:5000/api',
  
  baseURL: 'http://localhost:5000/api',  // 替换为你的服务器地址
  
  inviteCodeValidate: '/invite-codes/validate',
};
```

### 4.2 重新构建前端

```bash
cd web
npm run tauri:build
```

## 五、防火墙配置

### 5.1 开放端口

**Linux (Ubuntu):**
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5000/tcp  # 如果不使用 Nginx
sudo ufw enable
```

**云服务器安全组：**
- 在阿里云/腾讯云等控制台中，开放 80、443、5000 端口

## 六、测试部署

### 6.1 测试代理后台

```bash
# 测试健康检查
curl http://your-domain.com/api/health

# 或
curl http://your-server-ip:5000/api/health
```

### 6.2 测试前端

1. 安装重新构建的快泛claw应用
2. 启动应用
3. 尝试验证邀请码

## 七、维护和监控

### 7.1 查看日志

```bash
# PM2 日志
pm2 logs agent-backend

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 7.2 备份数据库

```bash
# 备份 MongoDB
mongodump --db agent-backend --out /path/to/backup

# 恢复
mongorestore --db agent-backend /path/to/backup/agent-backend
```

## 八、常见问题

### Q: 无法连接到服务器？
A: 检查防火墙设置，确保端口已开放。

### Q: CORS 错误？
A: 确保代理后台已配置 CORS（我们的代码中已经配置了）。

### Q: 数据库连接失败？
A: 检查 MongoDB 是否正常运行，连接字符串是否正确。

## 九、安全建议

1. **使用 HTTPS**：始终使用 HTTPS 加密传输
2. **强密码**：使用强密码保护数据库和服务器
3. **定期更新**：定期更新 Node.js、MongoDB 和 Nginx
4. **防火墙**：配置防火墙，只开放必要的端口
5. **日志监控**：定期查看日志，发现异常及时处理

## 联系支持

如有问题，请参考项目文档或联系技术支持。
