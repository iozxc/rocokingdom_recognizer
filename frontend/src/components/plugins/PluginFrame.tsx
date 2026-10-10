import React, { useEffect, useRef, useState } from 'react';
import { pluginApi, PluginInfo } from '../../services/pluginApi';

/**
 * 用 iframe 承载插件前端：插件前端与主程序同源，直接调用 /api/plugin-run/<id>。
 *
 * 高度自适应：插件 UI 由主程序提供（同源），所以这里可以直接量 iframe 内部文档的
 * 内容高度，把 iframe 撑到刚好装下插件页面 —— 否则 iframe 只会用默认的 150px，
 * 插件内容被裁掉、弹窗里出现一条多余的滚动条。
 *
 * 量不到内部文档（跨域/还没加载好）时自动退回 h-full（填满容器），不会比原来更差。
 */
const MIN_HEIGHT = 200;
/** 上限：弹窗 max-h 是 86vh，这里再扣掉标题栏/留白，超出的部分交给外层滚动。 */
const clampMax = () => Math.max(320, Math.round(window.innerHeight * 0.86) - 108);

export const PluginFrame: React.FC<{ plugin: PluginInfo; className?: string; fill?: boolean }> = ({
  plugin, className = '', fill = false,
}) => {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 整页插件（ui.fullscreen）：直接填满容器，不做高度自适应测量
    if (fill) { setHeight(null); return; }
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let timer: number | null = null;

    // 只量 body：documentElement.scrollHeight 至少是 iframe 视口高度，
    // 用它会造成「只涨不缩」的死循环。插件页 body 不写死高度，量出来就是内容高度。
    const measure = () => {
      const body = el.contentDocument?.body;
      if (!body) return;
      const content = Math.max(body.scrollHeight, Math.ceil(body.getBoundingClientRect().height));
      if (content <= 0) return;
      setHeight(Math.min(Math.max(content, MIN_HEIGHT), clampMax()));
    };

    const attach = () => {
      try {
        const doc = el.contentDocument;
        if (!doc?.body) return;
        measure();
        ro = new ResizeObserver(measure);
        ro.observe(doc.body);
        mo = new MutationObserver(measure);
        mo.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch {
        setHeight(null); // 跨域：退回填满容器
      }
    };

    const onLoad = () => attach();
    el.addEventListener('load', onLoad);
    if (el.contentDocument?.body) attach();

    // 兜底轮询：插件首屏的异步渲染（下载进度、图片等）不一定触发上面的监听
    timer = window.setInterval(measure, 700);
    const stopId = window.setTimeout(() => {
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    }, 8000);

    return () => {
      el.removeEventListener('load', onLoad);
      ro?.disconnect();
      mo?.disconnect();
      if (timer !== null) window.clearInterval(timer);
      window.clearTimeout(stopId);
    };
  }, [plugin.id, fill]);

  return (
    <iframe
      ref={ref}
      title={plugin.title}
      src={pluginApi.frameUrl(plugin)}
      style={!fill && height ? { height: `${height}px` } : undefined}
      className={`w-full border-0 bg-white dark:bg-slate-900 ${!fill && height ? 'block' : 'h-full'} ${className}`}
    />
  );
};
