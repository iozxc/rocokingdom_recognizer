// 纯前端版（vite build --mode web）运行时只认 public-web/resources/*。
//
// 这些文件是「仓库根资源」的副本：public-web/ 整个目录被 gitignore（属于构建产物），
// 历史上靠手工拷贝，于是踩过两次坑：
//   1) resources/videos.json 漏拷 → web 端点「视频攻略」请求 404，ESA 的 SPA 回退
//      把 index.html 当 JSON 返回（控制台：Unexpected token '<', "<!doctype "...）；
//   2) changelog.json 根目录修好了、副本没跟着更新 → 「下载桌面版」弹窗更新日志整块空掉
//      （控制台：Unexpected token ']' ... is not valid JSON）。
//
// 所以这里统一在构建时自动同步，并顺手做一次 JSON 合法性校验，
// 让「JSON 写错 / 副本漏拷」在 npm run build:web 阶段就报错，而不是运行时静默降级。
//
// 用法：node scripts/sync-web-resources.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(frontendDir, '..');
const destDir = join(frontendDir, 'public-web', 'resources');

// [仓库根相对路径, public-web/resources 下的文件名]
const RESOURCES = [
    ['version.json', 'version.json'],
    ['changelog.json', 'changelog.json'],
    [join('resources', 'chat.json'), 'chat.json'],
    [join('resources', 'videos.json'), 'videos.json'],
    [join('resources', 'qrcode_1.png'), 'qrcode_1.png'],
];

mkdirSync(destDir, { recursive: true });

const problems = [];
let changed = 0;
let same = 0;

for (const [srcRel, name] of RESOURCES) {
    const from = join(repoRoot, srcRel);
    const to = join(destDir, name);

    if (!existsSync(from)) {
        problems.push(`缺少仓库根资源 ${srcRel}`);
        continue;
    }

    // JSON 必须能解析：写坏了（如尾随逗号）在这里就拦住
    if (name.endsWith('.json')) {
        const text = readFileSync(from, 'utf-8');
        try {
            JSON.parse(text);
        } catch (e) {
            problems.push(`${srcRel} 不是合法 JSON：${e.message}`);
            continue;
        }
    }

    // 内容一致就跳过，避免无谓改动 mtime（ESA 会跟着 Last-Modified 变）
    if (existsSync(to) && statSync(to).size === statSync(from).size
        && readFileSync(to).equals(readFileSync(from))) {
        same++;
        continue;
    }

    copyFileSync(from, to);
    changed++;
    console.log(`[sync-web-resources] 更新 ${name}  ←  ${srcRel}`);
}

if (problems.length) {
    console.error('[sync-web-resources] 同步失败：');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('  （web 版会因此拿不到 更新日志 / 视频攻略 / QQ 群二维码 等配置）');
    process.exit(1);
}

console.log(`[sync-web-resources] public-web/resources 已同步：更新 ${changed} 个，未变 ${same} 个`);
