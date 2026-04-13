// API 配置
// 在生产环境部署时，将此地址修改为你的服务器公网地址
// 例如: 'https://your-server.com/api' 或 'http://your-server-ip:5000/api'

export const API_CONFIG = {
  // 开发环境使用本地地址
  // 生产环境修改为你的服务器地址
  baseURL: 'http://localhost:5000/api',
  
  // 邀请码验证接口
  inviteCodeValidate: '/invite-codes/validate',
  
  // 更新服务地址
  updateServiceBaseURL: 'http://localhost:3001/api',
  
  // 版本检查接口
  versionCheck: {
    app: '/versions/app',
    openclaw: '/versions/openclaw'
  }
};

// 获取完整的 API 地址
export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.baseURL}${endpoint}`;
};

// 快速获取邀请码验证 API 地址
export const getInviteCodeValidateUrl = (): string => {
  return getApiUrl(API_CONFIG.inviteCodeValidate);
};

// 快速获取版本检查 API 地址
export const getAppVersionCheckUrl = (currentVersion: string): string => {
  return `${API_CONFIG.updateServiceBaseURL}${API_CONFIG.versionCheck.app}?currentVersion=${currentVersion}`;
};

export const getOpenClawVersionCheckUrl = (currentVersion: string): string => {
  return `${API_CONFIG.updateServiceBaseURL}${API_CONFIG.versionCheck.openclaw}?currentVersion=${currentVersion}`;
};
