// 版本管理配置
// 当发布新版本时，更新此文件中的版本信息

module.exports = {
  // 应用版本信息
  app: {
    current: '1.0.1',
    // 历史版本记录
    history: [
      {
        version: '1.0.1',
        releaseDate: '2026-04-12',
        changelog: '\n• 新增版本更新功能\n• 修复已知问题\n• 性能优化',
        downloadUrl: 'http://your-server:3001/updates/app/kuafan-claw-1.0.1.zip'
      },
      {
        version: '1.0.0',
        releaseDate: '2026-04-10',
        changelog: '\n• 初始版本发布\n• 支持OpenClaw-CN安装\n• 支持多平台机器人管理',
        downloadUrl: 'http://your-server:3001/updates/app/kuafan-claw-1.0.0.zip'
      }
    ]
  },
  
  // OpenClaw版本信息
  openclaw: {
    current: '1.0.0',
    // 历史版本记录
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