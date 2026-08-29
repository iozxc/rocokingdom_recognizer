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
        本程序以源码可见（Source-Available）方式发布，开源、永久免费，禁止二次分发、再分发及任何形式的商业使用。
      </p>

      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 text-rose-700">
        <p className="font-semibold">
          任何通过付费渠道、卡密渠道、代下渠道、网盘贩卖、二手转卖、打包收费等方式向你提供本程序的行为，
          均属于非法传播或恶意牟利。
        </p>
        <p className="mt-2 text-rose-600/90">
          若你是通过付费获得本程序，请立即停止继续向对方付款，并尽快申请退款、投诉或维权——你的权益已受损，
          出售者并不具备合法收费授权。请仅从以下官方地址获取最新版本，避免下载被二次打包、植入风险代码或被篡改的文件：
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

      <ol className="space-y-2.5 list-decimal pl-5 marker:text-[#7ABCF4]">
        <li>
          <b className="text-slate-800">用途说明：</b>
          本程序仅用于图像识别学习与个人技术研究，不提供任何官方授权。请勿用于商业牟利、批量传播、
          代练代刷或其他破坏游戏公平性的用途。若你仅为测试或学习，请在下载、复制或接触本程序后的 24 小时内
          自行删除全部文件与副本。
        </li>
        <li>
          <b className="text-slate-800">实现逻辑说明：</b>
          本程序当前采用屏幕截图、模板识别、OCR 等方式工作，用于识别精灵图标、名字、地图等信息。
          程序设计目标是不直接访问游戏内存、不注入 DLL、不加载驱动，也不修改游戏资源文件。
        </li>
        <li>
          <b className="text-slate-800">风险提示：</b>
          即使本程序未主动访问游戏内存，也不能保证不会被游戏、平台或安全系统识别为异常自动化行为。
          使用本程序可能导致包括但不限于警告、限制、收益回收、临时封禁、永久封禁、账号异常、
          设备环境标记等风险，上述风险始终由使用者自行判断并承担。
        </li>
        <li>
          <b className="text-slate-800">法律与协议责任：</b>
          你应自行确认所在地区法律法规、平台规则、游戏用户协议及社区规范是否允许此类工具存在或使用。
          若因安装、传播、改造、二次分发或实际运行本程序而引发任何法律纠纷、平台处罚、账号损失、
          设备损害或第三方索赔，责任均由实际使用者承担。
        </li>
        <li>
          <b className="text-slate-800">使用者承诺：</b>
          你承诺仅在知情、自愿、可承担后果的前提下使用本程序；不会将其包装为收费产品、不会冒充官方工具、
          不会将其用于任何违法违规或侵害他人权益的行为；若你不同意本协议中的任一条款，请退出本程序。
        </li>
      </ol>
    </div>
);
