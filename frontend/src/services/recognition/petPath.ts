/**
 * 精灵数据集文件名解析 —— 1:1 复刻后端 core/infra/pet_path.py。
 *
 * 单形态： 002_喵喵.png        -> { id:2,  seq:null, name:'喵喵' }
 * 多形态： 001_01_迪莫.png     -> { id:1,  seq:1,    name:'迪莫' }
 * 多视角： 001_01_迪莫_shot.png-> { id:1,  seq:1,    name:'迪莫_shot' }
 *
 * 名字本身允许含下划线（如 乌达_极夜），只有紧跟 id 的纯数字段才算形态序号。
 */

const RE_EXT = /^(\d{1,4})_(?:(\d{1,3})_)?(.+)\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i;
const RE_NO_EXT = /^(\d{1,4})_(?:(\d{1,3})_)?(.+)$/;
const RE_TAIL_EXT = /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i;

export interface PetNameInfo {
  id: number | null;
  seq: number | null;
  name: string;
  ext: string | null;
}

export function splitPetFilename(filename: string): PetNameInfo | null {
  if (!filename) return null;
  const name = String(filename).trim();
  let m = RE_EXT.exec(name);
  if (m) {
    return { id: parseInt(m[1], 10), seq: m[2] ? parseInt(m[2], 10) : null, name: m[3], ext: m[4].toLowerCase() };
  }
  m = RE_NO_EXT.exec(name);
  if (!m) {
    // 不含 id 前缀的纯名字
    const extM = RE_TAIL_EXT.exec(name);
    return { id: null, seq: null, name: name.replace(RE_TAIL_EXT, ''), ext: extM ? extM[1].toLowerCase() : null };
  }
  return { id: parseInt(m[1], 10), seq: m[2] ? parseInt(m[2], 10) : null, name: m[3], ext: null };
}
