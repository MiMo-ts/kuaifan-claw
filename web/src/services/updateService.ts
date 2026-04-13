import { getAppVersionCheckUrl, getOpenClawVersionCheckUrl } from '../config/api';

interface VersionInfo {
  latestVersion: string;
  hasUpdate: boolean;
  downloadUrl: string;
  changelog: string;
}

interface VersionCheckResponse {
  success: boolean;
  data: VersionInfo;
}

class UpdateService {
  // 检查应用版本
  async checkAppVersion(currentVersion: string): Promise<VersionInfo> {
    try {
      const response = await fetch(getAppVersionCheckUrl(currentVersion));
      const data: VersionCheckResponse = await response.json();
      
      if (data.success) {
        return data.data;
      } else {
        throw new Error('版本检查失败');
      }
    } catch (error) {
      console.error('版本检查失败:', error);
      return {
        latestVersion: currentVersion,
        hasUpdate: false,
        downloadUrl: '',
        changelog: ''
      };
    }
  }

  // 检查OpenClaw版本
  async checkOpenClawVersion(currentVersion: string): Promise<VersionInfo> {
    try {
      const response = await fetch(getOpenClawVersionCheckUrl(currentVersion));
      const data: VersionCheckResponse = await response.json();
      
      if (data.success) {
        return data.data;
      } else {
        throw new Error('OpenClaw版本检查失败');
      }
    } catch (error) {
      console.error('OpenClaw版本检查失败:', error);
      return {
        latestVersion: currentVersion,
        hasUpdate: false,
        downloadUrl: '',
        changelog: ''
      };
    }
  }

  // 下载并安装更新
  async downloadAndInstallUpdate(url: string): Promise<boolean> {
    try {
      // 在实际应用中，这里会使用Tauri的文件下载API
      // 然后调用安装更新的方法
      console.log('开始下载更新:', url);
      
      // 模拟下载过程
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('更新下载完成');
      return true;
    } catch (error) {
      console.error('更新下载失败:', error);
      return false;
    }
  }
}

export const updateService = new UpdateService();