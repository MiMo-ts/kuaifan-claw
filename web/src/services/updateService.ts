// GitHub API 配置
import { invoke } from '@tauri-apps/api/core';

const GITHUB_API = 'https://api.github.com';
const OWNER = 'MiMo-ts';
const REPO = 'kuaifan-claw';

export interface ReleaseInfo {
  tag_name: string;
  version: string;
  name: string;
  body: string;
  published_at: string;
  assets: { name: string; browser_download_url: string }[];
  is_latest: boolean;
}

interface VersionInfo {
  latestVersion: string;
  hasUpdate: boolean;
  downloadUrl: string;
  changelog: string;
}

class UpdateService {
  // 从 GitHub 获取最新版本信息
  async fetchLatestVersion(): Promise<ReleaseInfo | null> {
    try {
      const response = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases/latest`);
      if (!response.ok) throw new Error('获取版本信息失败');
      const data = await response.json();
      return {
        tag_name: data.tag_name,
        version: data.tag_name.replace('v', ''),
        name: data.name || data.tag_name,
        body: data.body || '',
        published_at: data.published_at,
        assets: data.assets || [],
        is_latest: true,
      };
    } catch (error) {
      console.error('获取最新版本失败:', error);
      return null;
    }
  }

  // 从 GitHub 获取所有版本（最新3个）
  async fetchRecentReleases(count: number = 3): Promise<ReleaseInfo[]> {
    try {
      const response = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases?per_page=${count}`);
      if (!response.ok) throw new Error('获取版本列表失败');
      const data = await response.json();
      return data.map((release: any, index: number) => ({
        tag_name: release.tag_name,
        version: release.tag_name.replace('v', ''),
        name: release.name || release.tag_name,
        body: release.body || '',
        published_at: release.published_at,
        assets: release.assets || [],
        is_latest: index === 0,
      }));
    } catch (error) {
      console.error('获取版本列表失败:', error);
      return [];
    }
  }

  // 获取可下载的 exe 文件信息
  getExeAsset(release: ReleaseInfo): { name: string; url: string } | null {
    const exeAsset = release.assets.find(a => a.name.endsWith('-setup.exe') || a.name.endsWith('.exe'));
    if (exeAsset) {
      return { name: exeAsset.name, url: exeAsset.browser_download_url };
    }
    return null;
  }

  // 检查应用版本 - 兼容旧接口
  async checkAppVersion(currentVersion: string): Promise<VersionInfo> {
    const latest = await this.fetchLatestVersion();
    if (latest) {
      const current = currentVersion.replace('v', '');
      return {
        latestVersion: latest.version,
        hasUpdate: this.compareVersions(latest.version, current) > 0,
        downloadUrl: this.getExeAsset(latest)?.url || '',
        changelog: latest.body || latest.name,
      };
    }
    return {
      latestVersion: currentVersion,
      hasUpdate: false,
      downloadUrl: '',
      changelog: '',
    };
  }

  // 检查OpenClaw版本
  async checkOpenClawVersion(currentVersion: string): Promise<VersionInfo> {
    return {
      latestVersion: currentVersion,
      hasUpdate: false,
      downloadUrl: '',
      changelog: '',
    };
  }

  // 下载并安装更新
  async downloadAndInstallUpdate(url: string): Promise<boolean> {
    try {
      if (!url) {
        console.error('下载链接为空');
        return false;
      }
      console.log('开始下载更新:', url);
      await invoke('download_update', { url });
      return true;
    } catch (error) {
      console.error('更新下载失败:', error);
      return false;
    }
  }

  // 版本比较: 返回正数表示 v1 > v2
  compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}

export const updateService = new UpdateService();