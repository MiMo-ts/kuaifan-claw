// API 配置
// 在生产环境部署时，将此地址修改为你的服务器公网地址
// 例如: 'https://your-server.com/api' 或 'http://your-server-ip:5000/api'

export const API_CONFIG = {
  // 服务器地址
  baseURL: 'http://kuaifandl.asia:5000/api',
  serverURL: 'http://kuaifandl.asia:5000',

  // 邀请码验证接口
  inviteCodeValidate: '/invite-codes/validate',

  // 支付配置接口（走后端代理，解决 CORS）
  paymentSystemURL: 'http://8.148.152.185:7788',

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

// 支付相关接口
export const getPayConfigUrl = (): string => {
  return getApiUrl('/pay/config');
};

export const getServerUrl = (): string => {
  return API_CONFIG.serverURL;
};

export const getPayGotoUrl = (payUrl: string): string => {
  return `${API_CONFIG.serverURL}/api/pay/goto?url=${encodeURIComponent(payUrl)}`;
};

export const getPayCreateOrderUrl = (): string => {
  return getApiUrl('/pay/create-order');
};

export const getPayStatusUrl = (outTradeNo: string): string => {
  return getApiUrl(`/pay/status/${outTradeNo}`);
};

// 快速获取版本检查 API 地址
export const getAppVersionCheckUrl = (currentVersion: string): string => {
  return `${API_CONFIG.updateServiceBaseURL}${API_CONFIG.versionCheck.app}?currentVersion=${currentVersion}`;
};

export const getOpenClawVersionCheckUrl = (currentVersion: string): string => {
  return `${API_CONFIG.updateServiceBaseURL}${API_CONFIG.versionCheck.openclaw}?currentVersion=${currentVersion}`;
};
