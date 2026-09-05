import { PetItem, PetSkillInfo, PetTraitInfo } from '../types';
import { getPetSpecialType } from '../utils/petHelper';

/** 纯前端 dev/离线模式下的元素特色特性与技能库。 */

interface ElementSkillSet {
  traits: PetTraitInfo[];
  bossTraits: PetTraitInfo[];
  skills: PetSkillInfo[];
}

const ELEMENT_SKILL_DATABASE: Record<string, ElementSkillSet> = {
  '草': {
    traits: [
      { id: 'T_GRASS_1', name: '茂盛', desc: '生命低于 50% 时，草系技能威力提升 50%；每回合结束回复 5% 最大生命。' },
      { id: 'T_GRASS_2', name: '叶之呼吸', desc: '使用草系技能后回复 10% 生命，回合结束额外回复 1 点行动能量。' },
      { id: 'T_GRASS_3', name: '翠绿之心', desc: '免疫中毒与麻痹状态，应对成功时使敌方下回合能耗 +1。' },
    ],
    bossTraits: [
      { id: 'TB_GRASS_1', name: '远古神树威压', desc: '首领特性：开场获得 30% 全伤害减免，受致命攻击时保留 1 点生命并吸取敌方 3 点能量。' },
    ],
    skills: [
      { sid: 'SK_G_1', name: '阳光烈焰', skill_type: '攻击', element: '草', damage_kind: '魔法', energy_cost: 4, power: 130, desc: '凝聚强烈的自然日光轰击对手，命中后驱散自身所有减益状态。' },
      { sid: 'SK_G_2', name: '飞叶狂暴', skill_type: '攻击', element: '草', damage_kind: '物理', energy_cost: 2, power: 85, desc: '高速发射锋利飞叶攻击，若自身处于增益状态则暴击率提升 30%。' },
      { sid: 'SK_G_3', name: '寄生光合', skill_type: '状态', element: '草', energy_cost: 2, desc: '给对手播撒寄生种子，每回合抽取其 10% 生命并为自己提供双防提升。' },
      { sid: 'SK_G_4', name: '荆棘护体', skill_type: '防御', element: '草', energy_cost: 1, desc: '减免 75% 受到伤害，成功格挡攻击时反弹相当于攻击者 20% 威力的刺伤。' },
    ],
  },
  '火': {
    traits: [
      { id: 'T_FIRE_1', name: '猛火', desc: '生命偏低时火系技能伤害大幅提升，攻击时有 35% 概率附带灼烧效果。' },
      { id: 'T_FIRE_2', name: '灼热之躯', desc: '受到近战物理攻击时，使攻击者陷入 3 回合灼烧状态，攻击力下降 20%。' },
      { id: 'T_FIRE_3', name: '烈焰熔炉', desc: '每次成功造成火属性伤害，自身暴击伤害永久提升 15%（最多叠 4 层）。' },
    ],
    bossTraits: [
      { id: 'TB_FIRE_1', name: '不灭神凰威慑', desc: '首领特性：入场造成全场烈焰风暴，敌方全体获得 2 层灼烧，自身攻击力提升 40%。' },
    ],
    skills: [
      { sid: 'SK_F_1', name: '烈焰冲击', skill_type: '攻击', element: '火', damage_kind: '物理', energy_cost: 3, power: 120, desc: '裹挟炽热火环撞击对手，造成极高物理爆发，对灼烧目标威力提升 30%。' },
      { sid: 'SK_F_2', name: '炽火焚天', skill_type: '攻击', element: '火', damage_kind: '魔法', energy_cost: 4, power: 135, desc: '降下熔岩火雨，驱散对手护盾并造成大额魔法伤害。' },
      { sid: 'SK_F_3', name: '聚气狂暴', skill_type: '状态', element: '火', energy_cost: 2, desc: '聚集灼热意志，立即获得 2 点能量且下一次火系攻击必定命中并暴击。' },
      { sid: 'SK_F_4', name: '烈火之盾', skill_type: '防御', element: '火', energy_cost: 1, desc: '架起灼热烈火之壁，减免 70% 伤害，并清除自身冻结与减速负面状态。' },
    ],
  },
  '水': {
    traits: [
      { id: 'T_WATER_1', name: '激流涌动', desc: '进入战斗时速度提升 25 点，受到暴击时立刻回复 15% 生命并获得护盾。' },
      { id: 'T_WATER_2', name: '潮汐净化', desc: '回合开始时自动净化自身 1 个减益状态，水系技能能耗减 1。' },
    ],
    bossTraits: [
      { id: 'TB_WATER_1', name: '深海怒涛领袖', desc: '首领特性：敌方每使用 1 次技能自身充能 +1，且无视克制属性的部分伤害。' },
    ],
    skills: [
      { sid: 'SK_W_1', name: '激流巨浪', skill_type: '攻击', element: '水', damage_kind: '魔法', energy_cost: 3, power: 110, desc: '召唤滔天海浪冲击敌阵，降低对手 30% 命中率与行动速度。' },
      { sid: 'SK_W_2', name: '水流穿刺', skill_type: '攻击', element: '水', damage_kind: '物理', energy_cost: 2, power: 85, desc: '以压缩水刃进行连环刺击，无视目标 30% 物理护甲。' },
      { sid: 'SK_W_3', name: '润物无声', skill_type: '状态', element: '水', energy_cost: 2, desc: '水灵之露滋润全身，立即恢复 25% 生命并提升自身魔攻 40%。' },
      { sid: 'SK_W_4', name: '水泡结界', skill_type: '防御', element: '水', energy_cost: 1, desc: '张开高韧性水泡结界，减免 80% 攻击伤害，反弹 1 层减速减益。' },
    ],
  },
  '光': {
    traits: [
      { id: 'T_LIGHT_1', name: '圣光眷顾', desc: '神圣光芒笼罩，受到幽暗与恶系伤害减少 40%，技能命中率固定为 100%。' },
      { id: 'T_LIGHT_2', name: '极光闪耀', desc: '攻击命中后使对手致盲 1 回合，己方技能威力随着回合数逐渐增强。' },
    ],
    bossTraits: [
      { id: 'TB_LIGHT_1', name: '圣光救赎真神', desc: '首领特性：完全免疫控制状态，入场时驱散敌方全部增益状态并封印其特性 1 回合。' },
    ],
    skills: [
      { sid: 'SK_L_1', name: '极光审判', skill_type: '攻击', element: '光', damage_kind: '魔法', energy_cost: 4, power: 140, desc: '引天际圣光降下制裁，对暗黑或恶属性目标造成双倍克制伤害。' },
      { sid: 'SK_L_2', name: '破晓光刃', skill_type: '攻击', element: '光', damage_kind: '物理', energy_cost: 2, power: 90, desc: '凝聚光剑凌厉斩击，命中后偷取对手 1 点能量。' },
      { sid: 'SK_L_3', name: '光明祝福', skill_type: '状态', element: '光', energy_cost: 2, desc: '激活圣光印记，自身双攻提升 50%，速度提升 30，持续 3 回合。' },
      { sid: 'SK_L_4', name: '圣盾守护', skill_type: '防御', element: '光', energy_cost: 1, desc: '展开纯净光之神盾，减伤 85%，应对成功后回复自身 10% 生命。' },
    ],
  },
  '电': {
    traits: [
      { id: 'T_ELEC_1', name: '高压静电', desc: '身披高压电弧，接触攻击使对手陷入麻痹，电系技能暴击率 +25%。' },
      { id: 'T_ELEC_2', name: '雷霆超导', desc: '每当消耗能量时，释放电弧对敌方造成 40 点固定真实伤害。' },
    ],
    bossTraits: [
      { id: 'TB_ELEC_1', name: '九天雷劫主宰', desc: '首领特性：回合开始时引发全场落雷，有 50% 概率使对手直接跳过当前回合。' },
    ],
    skills: [
      { sid: 'SK_E_1', name: '雷霆万钧', skill_type: '攻击', element: '电', damage_kind: '魔法', energy_cost: 4, power: 135, desc: '万道天雷汇聚轰落，高暴击伤害，命中后目标有 60% 概率陷入麻痹。' },
      { sid: 'SK_E_2', name: '电光疾刺', skill_type: '攻击', element: '电', damage_kind: '物理', energy_cost: 2, power: 85, desc: '化身雷光极速突刺，先手度 +1，打断对手蓄力状态。' },
      { sid: 'SK_E_3', name: '过载充能', skill_type: '状态', element: '电', energy_cost: 1, desc: '激发体内发电机，立即回复 3 点能量并使下回合技能威力提升 60%。' },
      { sid: 'SK_E_4', name: '磁暴力场', skill_type: '防御', element: '电', energy_cost: 1, desc: '展开电磁偏转力场，减免 70% 伤害，使物理攻击者麻痹 1 回合。' },
    ],
  },
  '龙': {
    traits: [
      { id: 'T_DRAGON_1', name: '龙魂威慑', desc: '龙族古老血脉觉醒，降低对手 20% 双攻，自身蓄力技能威力提升 40%。' },
      { id: 'T_DRAGON_2', name: '逆鳞', desc: '受到重击时愤怒激化，物攻魔攻翻倍，持续 2 回合。' },
    ],
    bossTraits: [
      { id: 'TB_DRAGON_1', name: '上古灭世龙尊', desc: '首领特性：龙威压制全场，敌方所有技能能耗 +1，自身对所有系别伤害均不减半。' },
    ],
    skills: [
      { sid: 'SK_D_1', name: '升龙破灭炮', skill_type: '攻击', element: '龙', damage_kind: '魔法', energy_cost: 5, power: 155, desc: '凝聚远古龙息轰击目标，造成毁灭性魔法伤害，无视防御类技能。' },
      { sid: 'SK_D_2', name: '极寒龙爪', skill_type: '攻击', element: '龙', damage_kind: '物理', energy_cost: 3, power: 105, desc: '以万钧龙爪撕裂空间，造成极强物理伤害并削弱敌方 40% 物理防御。' },
      { sid: 'SK_D_3', name: '苍穹龙舞', skill_type: '状态', element: '龙', energy_cost: 3, desc: '高亢龙吟震颤大地，自身攻击、防御与速度全面提升 50%。' },
      { sid: 'SK_D_4', name: '龙鳞铁壁', skill_type: '防御', element: '龙', energy_cost: 2, desc: '坚硬龙鳞覆盖全身，减伤 80%，免除所有异常状态影响。' },
    ],
  },
  '幽': {
    traits: [
      { id: 'T_GHOST_1', name: '潜影穿透', desc: '幽冥体质，无视普通系与武系伤害，受到伤害有 30% 几率完全虚无化。' },
      { id: 'T_GHOST_2', name: '怨念缠身', desc: '阵亡时强行剥夺击败者 5 点能量并施加永久衰竭减益。' },
    ],
    bossTraits: [
      { id: 'TB_GHOST_1', name: '深渊魔皇降世', desc: '首领特性：每次对手行动都有 40% 几率被噩梦恐惧打断，自身吸血比例为 50%。' },
    ],
    skills: [
      { sid: 'SK_GH_1', name: '百鬼夜行', skill_type: '攻击', element: '幽', damage_kind: '魔法', energy_cost: 4, power: 125, desc: '群幽嘶吼奔涌，造成大范围暗属性魔法伤害，目标技能陷入 1 回合冷却。' },
      { sid: 'SK_GH_2', name: '暗影爪击', skill_type: '攻击', element: '幽', damage_kind: '物理', energy_cost: 2, power: 85, desc: '从阴影中伸出鬼爪突袭，高几率暴击且吸取相当于造成伤害 30% 的生命。' },
      { sid: 'SK_GH_3', name: '灵魂恐吓', skill_type: '状态', element: '幽', energy_cost: 2, desc: '惊悚眼眸凝视目标，使其陷入恐惧与混乱，能量降低 2 点。' },
      { sid: 'SK_GH_4', name: '虚空替身', skill_type: '防御', element: '幽', energy_cost: 1, desc: '遁入虚空夹层，免疫本回合内全部直接伤害，回复 1 点能量。' },
    ],
  },
  '普通': {
    traits: [
      { id: 'T_NORM_1', name: '坚韧耐力', desc: '朴素的生命力，自身最大生命提升 30%，受到克制伤害减少 20%。' },
      { id: 'T_NORM_2', name: '好运连连', desc: '技能触发额外异常与暴击概率提高 30%，每回合 25% 几率免费释放技能。' },
    ],
    bossTraits: [
      { id: 'TB_NORM_1', name: '王者威严', desc: '首领特性：基础属性极其均衡强大，受到任何属性攻击均视作普通属性结算。' },
    ],
    skills: [
      { sid: 'SK_N_1', name: '终极撞击', skill_type: '攻击', element: '普通', damage_kind: '物理', energy_cost: 3, power: 110, desc: '全力一击以雷霆万钧之势冲撞，伤害平稳扎实。' },
      { sid: 'SK_N_2', name: '元气光炮', skill_type: '攻击', element: '普通', damage_kind: '魔法', energy_cost: 3, power: 100, desc: '蓄聚自然纯净元气释放光波，驱散目标所有护盾。' },
      { sid: 'SK_N_3', name: '鼓舞士气', skill_type: '状态', element: '普通', energy_cost: 2, desc: '昂扬斗志激励自身，双攻提升 40%，回复 2 点行动能量。' },
      { sid: 'SK_N_4', name: '绝对守住', skill_type: '防御', element: '普通', energy_cost: 1, desc: '全神贯注进入防守姿态，减免 80% 攻击伤害。' },
    ],
  },
};

/**
 * 根据精灵的属性和名称，智能解析出最相称的特性与技能组合。
 * 如果精灵自带了真实特性与技能，则优先使用自带数据；
 * 否则根据精灵的主属性与形态自动匹配丰富真实的技能数据。
 */
export function resolvePetSkillsAndTrait(pet: PetItem, fallbackSeed = 0): {
  trait: PetTraitInfo;
  skills: PetSkillInfo[];
} {
  // 如果已携带真实完整的技能和特性，直接使用
  if (pet.trait?.name && pet.skills && pet.skills.length > 0) {
    return {
      trait: pet.trait,
      skills: pet.skills,
    };
  }

  const primaryElement = pet.elements?.[0] || '草';
  const specialType = getPetSpecialType(pet);
  const isBoss = specialType === 'boss';

  // 查找对应系别的技能数据库，若不存在则降级为草系或普通系
  const db = ELEMENT_SKILL_DATABASE[primaryElement] || ELEMENT_SKILL_DATABASE['普通'] || ELEMENT_SKILL_DATABASE['草'];

  // 根据精灵名称和 ID 生成稳定伪随机索引，保证同一只精灵刷新后特性技能保持一致
  const seedString = `${pet.id || ''}_${pet.name}_${primaryElement}_${fallbackSeed}`;
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = (hash << 5) - hash + seedString.charCodeAt(i);
    hash |= 0;
  }
  const traitIndex = Math.abs(hash) % (isBoss ? db.bossTraits.length || 1 : db.traits.length);

  const matchedTrait = isBoss
    ? (db.bossTraits[traitIndex] || db.traits[0])
    : (db.traits[traitIndex] || db.traits[0]);

  // 如果原本已有 trait，但技能为空，则保留原本 trait
  const finalTrait = (pet.trait?.name ? pet.trait : matchedTrait);
  const finalSkills = (pet.skills && pet.skills.length > 0) ? pet.skills : db.skills;

  return {
    trait: finalTrait,
    skills: finalSkills,
  };
}

export function buildMockSkillData(index = 0): {
  trait: PetTraitInfo;
  skills: PetSkillInfo[];
} {
  const elements = ['草', '火', '水', '光', '电', '龙', '幽', '普通'];
  const el = elements[index % elements.length];
  const db = ELEMENT_SKILL_DATABASE[el] || ELEMENT_SKILL_DATABASE['草'];
  const isLeader = index % 3 === 2;
  const trait = isLeader ? (db.bossTraits[0] || db.traits[0]) : db.traits[index % db.traits.length];
  return {
    trait,
    skills: db.skills,
  };
}

