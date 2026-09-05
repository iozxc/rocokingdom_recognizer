import { PetSkillInfo, PetTraitInfo } from '../types';

/** 纯前端 dev/离线模式下用于调整 UI 的示例技能数据。 */
export const MOCK_TRAIT: PetTraitInfo = {
  id: 'TM001',
  name: '示例特性·叶之呼吸',
  desc: '使用草系技能后，回复 10% 生命；每回合结束额外回复 1 能量。',
};

export const MOCK_TRAIT_LEADER: PetTraitInfo = {
  id: 'TM002',
  name: '示例特性·首领威压',
  desc: '入场时敌方双防降低 20%，自身攻击技能威力提升 30%。',
};

export const MOCK_SKILL_GROUPS: PetSkillInfo[][] = [
  [
    { sid: 'SM001', name: '突袭', skill_type: '攻击', element: '普通', damage_kind: '物理', energy_cost: 1, power: 40, desc: '对敌方精灵造成物理伤害。' },
    { sid: 'SM002', name: '火焰切割', skill_type: '攻击', element: '火', damage_kind: '物理', energy_cost: 3, power: 100, desc: '对敌方精灵造成物理伤害。' },
    { sid: 'SM003', name: '光合作用', skill_type: '状态', element: '草', energy_cost: 4, desc: '自己获得 1 层光合印记。' },
    { sid: 'SM004', name: '防御', skill_type: '防御', element: '普通', energy_cost: 1, desc: '减伤 70%，应对攻击。' },
  ],
  [
    { sid: 'SM011', name: '地震', skill_type: '攻击', element: '地', damage_kind: '物理', energy_cost: 10, power: 190, desc: '对敌方精灵造成物理伤害。' },
    { sid: 'SM012', name: '泥浆铠甲', skill_type: '状态', element: '土', energy_cost: 2, desc: '自己获得物攻和物防+60%，应对防御时增益翻倍。' },
    { sid: 'SM013', name: '暴风雪', skill_type: '攻击', element: '冰', damage_kind: '魔法', energy_cost: 8, power: 150, desc: '造成魔伤，敌方获得 1 层冻结。' },
    { sid: 'SM014', name: '水泡盾', skill_type: '防御', element: '水', energy_cost: 2, desc: '减伤 80%，应对攻击：自己获得魔攻+70%。' },
  ],
  [
    { sid: 'SM021', name: '吹炎', skill_type: '攻击', element: '火', damage_kind: '物理', energy_cost: 3, power: 100, desc: '向敌方吐出一团火焰，造成物理伤害。' },
    { sid: 'SM022', name: '龙炮', skill_type: '攻击', element: '龙', damage_kind: '魔法', energy_cost: 6, power: 140, desc: '凝聚龙息轰击敌方，造成魔法伤害。' },
    { sid: 'SM023', name: '升龙咆哮', skill_type: '状态', element: '龙', energy_cost: 4, desc: '自己获得双攻+150%和速度+80。' },
    { sid: 'SM024', name: '龙息环爆', skill_type: '攻击', element: '龙', damage_kind: '魔法', energy_cost: 5, power: 120, desc: '龙息在敌方身上爆裂，造成魔法伤害。' },
  ],
];

export function buildMockSkillData(index = 0): {
  trait: PetTraitInfo;
  skills: PetSkillInfo[];
} {
  const group = MOCK_SKILL_GROUPS[index % MOCK_SKILL_GROUPS.length];
  const isLeaderLike = index % 2 === 1;
  return {
    trait: isLeaderLike ? MOCK_TRAIT_LEADER : MOCK_TRAIT,
    skills: group,
  };
}
