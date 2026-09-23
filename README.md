# 🎮 洛克王国徽章助手 RocoKingdomRecognizer

<p align="center">
  <b>《洛克王国》徽章试炼 · 精灵图像识别 / 图鉴检索助手</b><br>
  <sub>桌面端 + 纯前端网页版 · 本地推理 · 零内存修改 · 安全绿色</sub>
</p>

<p align="center">
  <a href="https://roco.omisheep.cn/"><img src="https://img.shields.io/badge/%E7%BD%91%E9%A1%B5%E7%89%88-%E7%AB%8B%E5%8D%B3%E4%BD%BF%E7%94%A8-4C8BF5?style=for-the-badge&logo=googlechrome&logoColor=white" alt="网页版"></a>
  &nbsp;
  <a href="https://github.com/iozxc/rocokingdom_recognizer/releases/latest"><img src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-Windows%20%E5%AE%89%E8%A3%85%E7%89%88-FF8C00?style=for-the-badge&logo=windows&logoColor=white" alt="下载"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/QQ%E4%BA%A4%E6%B5%81%E7%BE%A4-723155657-12B7F5?style=for-the-badge&logo=tencentqq&logoColor=white" alt="QQ群">
</p>

<p align="center">
  <a href="https://github.com/iozxc/rocokingdom_recognizer/releases/latest"><img src="https://img.shields.io/github/v/release/iozxc/rocokingdom_recognizer?label=%E7%89%88%E6%9C%AC&color=blue&style=flat-square" alt="版本"></a>
  <img src="https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/PyTorch-AI-EE4C2C?style=flat-square&logo=pytorch&logoColor=white" alt="PyTorch">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

<p align="center">
  <a href="https://roco.omisheep.cn/"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.omisheep.cn%2Fapi%2Fpublic%2Fbadge%3Fmetric%3Dweb_pv&style=flat-square" alt="网页浏览量"></a>
  <a href="https://github.com/iozxc/rocokingdom_recognizer/releases"><img src="https://img.shields.io/github/downloads/iozxc/rocokingdom_recognizer/total?label=GitHub%20%E4%B8%8B%E8%BD%BD&color=orange&style=flat-square" alt="GitHub 下载量"></a>
  <a href="https://github.com/iozxc/rocokingdom_recognizer/stargazers"><img src="https://img.shields.io/github/stars/iozxc/rocokingdom_recognizer?label=Stars&color=yellow&style=flat-square" alt="Stars"></a>
</p>


---

## 🌐 在线体验（网页版，免安装）

不想装软件？直接用浏览器打开 **<https://roco.omisheep.cn/>** —— 纯前端静态站点，
识别全部在浏览器本地完成，不上传游戏画面、也不需要登录。

---

# 洛克王国徽章试炼小助手

### 游戏跟随识别

- 游戏画面可直接识别出当前阶段和精灵槽位

![游戏跟随识别](resources/img_1.png)

- 具体样式 & 特殊点位识别：

![具体样式 & 特殊点位识别](resources/img_2.png)

## 主页面同步展示

![主页面同步展示](resources/img_3.png)

## 初始化识别对比
![主页面同步展示](resources/img_4.png)

## 历史记录
![历史记录](resources/img_5.png)

## 技能搜索
![技能搜索](resources/img_6.png)
# 下载

> 下面的链接**始终指向最新版本**，直接点进去就能看到当前最新版，不需要自己找版本号。

1. 【**最省事**】网页版，打开即用：[**roco.omisheep.cn**](https://roco.omisheep.cn/)（免安装，浏览器本地识别）
2. 【**推荐**】下载安装程序 `RocoKingdomRecognizer_Setup`：[GitHub Releases（最新版）](https://github.com/iozxc/rocokingdom_recognizer/releases/latest)
3. 下载免安装分卷压缩包：[Gitee Releases（最新版）](https://gitee.com/iozxc/rocokingdom_recognizer/releases/latest)

- 由于仓库限制，Gitee 的分卷（`RocoKingdomRecognizer_part.7z.001` 起）需要全部下载后一起选中再解压
- 也可以直接加群下载：`723155657`


# 🌟 项目简介

**RocoKingdomRecognizer** 是一款面向《洛克王国》图像识别与深度学习领域的技术演示作品。通过深度学习技术，演示自动识别精灵、场景及关键信息，并结合流畅的桌面端交互，探索视觉识别技术在图鉴检索场景的应用。

> **提示：** 本作品仅用于学习与技术交流，不涉及任何游戏内存修改，安全绿色。

---

# 🛠️ 技术栈

识别链路：窗口截图 → 版面检测 → 文字识别 / 特征检索 → 结果融合。

| 模块 | 技术 |
|:---|:---|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Flask + Waitress（本机服务） |
| 桌面端 | pywebview（主界面 + 跟随识别悬浮窗） |
| AI 识别 | YOLOv8 版面检测 + PP-OCRv4 文字识别 + ResNet50 特征检索，ONNX Runtime 推理 |
| 训练框架 | PyTorch + Ultralytics，模型统一导出 ONNX |
| 数据存储 | SQLite（图鉴库）+ JSON（用户数据） |
| 打包分发 | PyInstaller + Inno Setup |

---

# 📱 联系我们 & 反馈

如果你在使用过程中遇到 Bug，或者有精灵图鉴需要纠错，欢迎加入交流群：

- **QQ 交流群**：`723155657`
- **在线反馈**：已集成在 App 内部
- **Gitee Issue**：[点击提交反馈](https://gitee.com/iozxc/rocokingdom_recognizer/issues)

---

# 📥 安装与运行

1. 前往 [Releases（GitHub，最新版）](https://github.com/iozxc/rocokingdom_recognizer/releases/latest) 页面下载。
2. 前往 [Releases（国内 Gitee，最新版）](https://gitee.com/iozxc/rocokingdom_recognizer/releases/latest) 页面下载。
3. 运行安装程序，按照指引完成安装。
4. 桌面双击 **RocoKingdomRecognizer** 即可启动。

> 版本更新内容见 [CHANGELOG.md](CHANGELOG.md)，用户数据保存在 `roco_user_data.json`，覆盖安装或卸载都不会被删除。

---

# 🤝 参与贡献

如果你也想为洛克王国生态出一份力：

1. **Star** 本项目（这对我们非常重要！）。
2. 提交 Pull Request 修复 Bug 或增加新功能。
3. 帮助完善精灵识别模型的数据集。

---

# 📄 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。

---
<p align="center"> 
  如果这个项目帮到了你，请给一个 ⭐️ Star 吧！ 
</p>