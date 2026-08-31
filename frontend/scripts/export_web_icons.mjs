// 跨平台唤起 Python 运行 export_web_icons.py。
// 依次尝试 python / python3 / py，保证 Windows 与 Vercel(Linux) 都能跑。
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'export_web_icons.py');

const candidates =
    process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];

for (const cmd of candidates) {
    const r = spawnSync(cmd, [script], { stdio: 'inherit' });
    if (r.error) continue;
    if (r.status === 0) process.exit(0);
    process.exit(r.status ?? 1);
}

console.error('[export_web_icons] 未找到可用的 Python（已尝试 python/python3/py）。');
console.error('请在本地运行 `npm run export:web:icons`，或在构建环境中安装 Python 后重试。');
process.exit(1);
