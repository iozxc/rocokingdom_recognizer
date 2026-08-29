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
    <div className="space-y-4 text-[13px] leading-relaxed text-slate-600">
      <p className="text-slate-800 font-semibold">
        本程序以源码可见（Source-Available）方式发布，开源、永久免费，仅供个人学习与技术研究使用。
        未经授权，任何形式的二次分发、再分发及商业使用均被禁止。
      </p>

      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 text-rose-700">
        <p className="font-semibold">收费即骗 · 仅认官方渠道</p>
        <p className="mt-1.5 text-rose-600/90">
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
                  className="text-[#2B78C4] underline decoration-[#7ABCF4] underline-offset-2 hover:text-[#1c5fa8] break-all"
              >
                {item.label}：{item.url}
              </a>
          ))}
        </div>
      </div>

      <ol className="space-y-3 list-decimal pl-5 marker:text-[#7ABCF4]">
        <li>
          <b className="text-slate-800">用途说明：</b>
          本程序是面向《洛克王国：世界》的辅助识别工具，通过屏幕截图与图像识别（模板匹配、OCR 等）识别精灵、
          地图及相关信息，用于图鉴收集、学习与技术研究，不代表腾讯官方立场，亦不提供任何官方授权。
          请勿用于商业牟利、批量传播、代练代刷或任何破坏游戏公平性的用途。若你仅为测试或学习接触本程序，
          请在下载、复制或使用后的 24 小时内自行删除全部文件与副本。
        </li>
        <li>
          <b className="text-slate-800">实现逻辑与边界：</b>
          本程序仅基于屏幕截图与图像识别工作，对游戏界面做纯图像分析。
          程序设计明确不访问游戏内存、不注入 DLL、不加载驱动、不修改游戏资源文件，也不对游戏客户端进行任何篡改。
        </li>
        <li>
          <b className="text-slate-800">风险提示：</b>
          即使本程序不主动访问游戏内存，也无法保证不被游戏、平台或安全系统识别为异常自动化行为。
          使用本程序可能导致（包括但不限于）警告、限制、收益回收、临时或永久封禁、账号异常、设备环境标记等后果。
          上述风险均由使用者自行评估、判断并承担。
        </li>
        <li>
          <b className="text-slate-800">法律与责任：</b>
          你应自行确认所在地区法律法规、平台规则、游戏用户协议及社区规范是否允许使用此类工具。
          因安装、传播、改造、二次分发或实际运行本程序而引发的一切法律纠纷、平台处罚、账号损失、
          设备损害或第三方索赔，责任均由实际使用者承担。
        </li>
        <li>
          <b className="text-slate-800">使用者承诺：</b>
          你承诺在知情、自愿且能承担后果的前提下使用本程序；不将其包装为收费产品，不冒充官方工具，
          不用于任何违法违规或侵害他人权益的行为。若你不同意本协议任一条款，请立即退出程序并停止使用。
        </li>
      </ol>
    </div>
);
