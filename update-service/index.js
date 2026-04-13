const express = require('express');
const cors = require('cors');
const versionConfig = require('./config/versionConfig');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务 - 用于提供更新包下载
app.use('/updates', express.static('updates'));

// 版本检查路由
app.get('/api/versions/app', (req, res) => {
  const { currentVersion } = req.query;
  
  const hasUpdate = currentVersion && compareVersions(currentVersion, versionConfig.app.current) < 0;
  
  res.json({
    success: true,
    data: {
      latestVersion: versionConfig.app.current,
      hasUpdate,
      downloadUrl: versionConfig.app.history.find(v => v.version === versionConfig.app.current).downloadUrl,
      changelog: versionConfig.app.history.find(v => v.version === versionConfig.app.current).changelog
    }
  });
});

app.get('/api/versions/openclaw', (req, res) => {
  const { currentVersion } = req.query;
  
  const hasUpdate = currentVersion && compareVersions(currentVersion, versionConfig.openclaw.current) < 0;
  
  res.json({
    success: true,
    data: {
      latestVersion: versionConfig.openclaw.current,
      hasUpdate,
      downloadUrl: versionConfig.openclaw.history.find(v => v.version === versionConfig.openclaw.current).downloadUrl,
      changelog: versionConfig.openclaw.history.find(v => v.version === versionConfig.openclaw.current).changelog
    }
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 版本比较函数
function compareVersions(v1, v2) {
  const arr1 = v1.split('.');
  const arr2 = v2.split('.');
  
  for (let i = 0; i < Math.max(arr1.length, arr2.length); i++) {
    const num1 = parseInt(arr1[i] || '0');
    const num2 = parseInt(arr2[i] || '0');
    
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  
  return 0;
}

// 启动服务
app.listen(PORT, () => {
  console.log(`Update service running on port ${PORT}`);
});