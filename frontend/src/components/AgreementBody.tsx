import React from 'react';

export const PROJECT_URL = 'https://gitee.com/iozxc/rocokingdom_recognizer';
export const GITHUB_URL = 'https://github.com/iozxc/rocokingdom_recognizer';

const SOURCE_LINKS = [
  { label: 'Gitee 仓库', url: PROJECT_URL },
  { label: 'GitHub 仓库', url: GITHUB_URL },
];


/**
 * 用户协议正文（不含头部/按钮），供首次开屏协议与设置里的“用户协议”弹窗复用。
 */
export const AgreementBody: React.FC = () => (
    <div className="space-y-4 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
      <p className="text-slate-800 dark:text-slate-100 font-semibold">
        本程序以源码可见（Source-Available）方式发布，开源、永久免费，仅供个人学习与技术研究使用。
        未经授权，任何形式的二次分发、再分发及商业使用均被禁止。
      </p>

      <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-3 text-rose-700 dark:text-rose-300">
        <p className="font-semibold">收费即骗 · 仅认官方渠道</p>
        <p className="mt-1.5 text-rose-600/90 dark:text-rose-300/90">
          任何通过付费渠道、卡密、代下、网盘贩卖、二手转卖、打包收费等方式向你提供本程序的行为，均属非法传播或恶意牟利。
          若你是付费获得，请立即停止支付，并尽快申请退款、投诉或维权——你的权益已受损，出售者并无合法收费授权。
          请务必仅从以下官方地址获取最新版本，避免下载被二次打包、植入风险代码或被篡改的文件：
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {SOURCE_LINKS.map((item) => (
              <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#2B78C4] dark:text-sky-400 underline decoration-[#7ABCF4] underline-offset-2 hover:text-[#1c5fa8] dark:hover:text-sky-300 break-all"
              >
                {item.label}：{item.url}
              </a>
          ))}
        </div>
      </div>

      <ol className="space-y-3 list-decimal pl-5 marker:text-[#7ABCF4]">
        <li>
          <b className="text-slate-800 dark:text-slate-100">用途说明：</b>
          本程序是面向图像识别与深度学习领域的技术演示作品，通过屏幕截图与图像识别（模板匹配、OCR 等）演示精灵、
          地图及相关信息的识别效果，仅用于图鉴数据展示、编程学习与技术研究，不代表腾讯官方立场，亦不提供任何官方授权。
          请勿用于商业牟利、批量传播、代练代刷或任何破坏游戏公平性的用途。若你仅为测试或学习接触本程序，
          请在下载、复制或使用后的 24 小时内自行删除全部文件与副本。
        </li>
        <li>
          <b className="text-slate-800 dark:text-slate-100">实现逻辑与边界：</b>
          本程序仅基于屏幕截图与图像识别工作，对画面做纯图像算法演示与分析。
          程序设计明确不访问游戏内存、不注入 DLL、不加载驱动、不修改游戏资源文件，也不对游戏客户端进行任何篡改。
        </li>
        <li>
          <b className="text-slate-800 dark:text-slate-100">风险提示与责任豁免：</b>
          即使本程序不主动访问游戏内存，也无法保证不被游戏、平台或安全系统识别为异常行为。
          游戏官方用户协议禁止各类第三方工具，使用者确认已充分知晓该规则，如仍自愿使用本项目，
          由此产生的警告、限制、收益回收、账号异常、临时或永久封禁、设备环境标记等全部风险与后果，
          均由使用者本人独立评估、判断并承担，本项目开发者不承担任何直接或间接责任。
        </li>
        <li>
          <b className="text-slate-800 dark:text-slate-100">法律与合规：</b>
          你应自行确认所在地区法律法规、平台规则、游戏用户协议及社区规范是否允许运行此类演示作品。
          因安装、传播、改造、二次分发或实际运行本程序而引发的一切法律纠纷、平台处罚、账号损失、
          设备损害或第三方索赔，责任均由实际使用者承担。
        </li>
        <li>
          <b className="text-slate-800 dark:text-slate-100">使用者承诺：</b>
          你承诺在知情、自愿且能承担后果的前提下使用本程序；不将其包装为收费产品，不冒充官方作品，
          不用于任何违法违规或侵害他人权益的行为。若你不同意本协议任一条款，请立即退出程序并停止使用。
        </li>
      </ol>
    </div>
);
