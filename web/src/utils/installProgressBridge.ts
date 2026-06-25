/** 与 App 内 InstallProgressBridge 桥接的浏览器事件名（全局单例 listen，各页通过 window 监听） */
export const INSTALL_PROGRESS_DOM_EVENT = 'openclaw-manager-install-progress';

export interface InstallProgressPayload {
  stage: string;
  status: string;
  percent?: number;
  message: string;
}
