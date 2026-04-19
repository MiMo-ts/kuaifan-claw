import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  body?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/**
 * 检查是否有可用更新
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const update = await check();

    if (update) {
      return {
        available: true,
        version: update.version,
        body: update.body || undefined,
      };
    }

    return { available: false };
  } catch (error) {
    console.error('检查更新失败:', error);
    return { available: false };
  }
}

/**
 * 下载并安装更新
 * @param onProgress 进度回调
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  const update = await check();

  if (!update) {
    throw new Error('没有可用更新');
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength || 0;
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      if (onProgress && totalBytes > 0) {
        onProgress({
          downloaded: downloadedBytes,
          total: totalBytes,
          percentage: Math.round((downloadedBytes / totalBytes) * 100),
        });
      }
    }
  });

  // 下载完成后重启应用
  await relaunch();
}

/**
 * 格式化文件大小
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
