import { useEffect } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { INSTALL_PROGRESS_DOM_EVENT, InstallProgressPayload } from '../utils/installProgressBridge';

/**
 * 全局桥接：Tauri `install-progress` → 浏览器 CustomEvent。
 * 必须挂在任意路由之外且常驻（如 App 内 BrowserRouter 下），否则从首页进入「聊天插件」页时
 * WizardPage 未挂载会导致无监听，安装界面一直停在「已请求后端」。
 */
export default function InstallProgressBridge() {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<InstallProgressPayload>('install-progress', (e) => {
      window.dispatchEvent(
        new CustomEvent(INSTALL_PROGRESS_DOM_EVENT, { detail: e.payload })
      );
    })
      .then((u) => {
        if (cancelled) {
          u();
          return;
        }
        unlisten = u;
      })
      .catch((err) => console.error('install-progress listen failed:', err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
