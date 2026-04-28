// ======================= 数据与配置 =======================
const userConfig = JSON.parse(localStorage.getItem('gameSettings')) || {};
const CONFIG = {
    TUNNEL_RADIUS: userConfig.TUNNEL_RADIUS || 20,
    SEGMENT_LEN: 300,
    BASE_SPEED: userConfig.BASE_SPEED || 0.5,
    BULLET_TIME_SPEED: 0.05,
    GRAZE_DISTANCE: userConfig.GRAZE_DISTANCE || 1.5,
    BGM_VOLUME: userConfig.BGM_VOLUME !== undefined ? userConfig.BGM_VOLUME : 0.5,
    OBSTACLE_DENSITY: userConfig.OBSTACLE_DENSITY || 1.8,
    MOUSE_SENSITIVITY: userConfig.MOUSE_SENSITIVITY || 10.0,
    INVINCIBLE_DURATION: 8000,
    BULLET_TIME_DURATION: 1200,
    CORE_STRING_DURATION: 3000,
    BIOME_LAVA_SCORE: 30000,
    BIOME_QUANTUM_SCORE: 80000,
};

const MODES = {
    rookie: { name: '新手', dmgMult: 1.0, maxSpeedMult: 2.0, scoreMult: 1.0, density: 0.9, iframe: 1200, stun: 0, endless: false, type: 'adv' },
    novice: { name: '普通', dmgMult: 1.2, maxSpeedMult: 2.7, scoreMult: 1.3, density: 1.4, iframe: 1200, stun: 0, endless: false, type: 'adv' },
    elite:  { name: '精英', dmgMult: 1.5, maxSpeedMult: 3.0, scoreMult: 1.8, density: 2.0, iframe: 150, stun: 100, endless: false, type: 'adv' },
    ace:    { name: '王牌', dmgMult: 2.0, maxSpeedMult: 3.5, scoreMult: 2.5, density: 2.2, iframe: 100, stun: 150, endless: false, type: 'adv' },
    endless:{ name: '无尽炼狱', dmgMult: 1.0, maxSpeedMult: Infinity, scoreMult: 1.5, density: 1.6, iframe: 1000, stun: 0, endless: true, type: 'endless' },
    super_core:{ name: '超级核心', dmgMult: 1.0, maxSpeedMult: 2.0, scoreMult: 1.0, density: 0, iframe: 1000, stun: 0, endless: false, type: 'special' },
    sweeper:{ name: '清道夫', dmgMult: 1.0, maxSpeedMult: 2.0, scoreMult: 1.0, density: 5.0, iframe: 1000, stun: 0, endless: false, type: 'special' }
};

function loadSaveData() {
    return {
        totalCores: parseInt(localStorage.getItem('totalCores')) || 0,
        magnetCount: parseInt(localStorage.getItem('magnetCount')) || 0,
        highScores: JSON.parse(localStorage.getItem('highScoresTime')) || [],
        upgrades: {
            armor: parseInt(localStorage.getItem('upgrade_armor')) || 0,
            engine: parseInt(localStorage.getItem('upgrade_engine')) || 0,
            weapon: parseInt(localStorage.getItem('upgrade_weapon')) || 0,
        },
        unlockedMechs: JSON.parse(localStorage.getItem('unlockedMechs')) || ['default'],
        currentMech: localStorage.getItem('currentMech') || 'default',
        achievements: JSON.parse(localStorage.getItem('achievements')) || [],
        isFirstPlay: localStorage.getItem('isFirstPlay') === null ? true : false
    };
}

let SAVE_DATA = loadSaveData();
let globalThree = { renderer: null, composer: null, scene: null, camera: null };

const MECH_CONFIGS = {
    default: { scale: 0.6, speed: 1.0, hp: 1.0, color: 0x00e5ff },
    heavy: { scale: 0.8, speed: 0.8, hp: 1.5, color: 0xffd700 },
    assassin: { scale: 0.5, speed: 1.2, hp: 0.8, color: 0x9933ff },
};

const METEOR_TYPES = [
    { id: 0, color: 0x888888, hpMult: 1, scoreMult: 1, name: "常规" },
    { id: 1, color: 0x4488ff, hpMult: 2, scoreMult: 2, name: "强化" },
    { id: 2, color: 0x00ff88, hpMult: 3, scoreMult: 3, name: "坚韧" },
    { id: 3, color: 0x9933ff, hpMult: 4, scoreMult: 5, name: "致密" },
    { id: 4, color: 0xffd700, hpMult: 5, scoreMult: 8, name: "极光" },
    { id: 5, color: 0xff4500, hpMult: 3, scoreMult: 1, name: "核心", isCore: true }
];

const TALENTS_DB = [
    { id: 'hp', stat: '装甲上限', name: '装甲强化', type: '生存', values: [20, 40, 70, 120], desc: ['+20', '+40', '+70', '+120'] },
    { id: 'regen', stat: '修复速率', name: '纳米修复', type: '生存', values: [2, 5, 20, 35], desc: ['2/s', '5/s', '20/s', '35/s'] },
    { id: 'dodge', stat: '闪避几率', name: '机动规避', type: '生存', values: [3, 6, 10, 20], desc: ['3%', '6%', '10%', '20%'] },
    { id: 'armor', stat: '伤害减免', name: '力场护盾', type: '生存', values: [4, 8, 16, 30], desc: ['-4', '-8', '-16', '-30'] },
    { id: 'dmg', stat: '火力增幅', name: '弹道强化', type: '进攻', values: [20, 50, 100, 200], desc: ['+20%', '+50%', '+100%', '+200%'] },
    { id: 'fireRate', stat: '射击频率', name: '射频优化', type: '进攻', values: [20, 30, 50, 100], desc: ['+20%', '+30%', '+50%', '+100%'] },
    { id: 'crit', stat: '暴击概率', name: '暴击矩阵', type: '进攻', values: [5, 10, 20, 35], desc: ['5%', '10%', '20%', '35%'] },
    { id: 'overload', stat: '过热抑制', name: '冷凝系统', type: '能量', values: [5, 10, 20, 35], desc: ['-5%', '-10%', '-20%', '-35%'] },
    { id: 'maxEn', stat: '能量容量', name: '蓄能扩容', type: '能量', values: [20, 40, 65, 100], desc: ['+20', '+40', '+65', '+100'] },
    { id: 'graze', stat: '擦弹判定', name: '引力增幅', type: '能量', values: [1, 2, 4, 7], desc: ['+1', '+2', '+4', '+7'] },
    { id: 'cdr', stat: '技能冷却', name: '同步加速', type: '能量', values: [5, 12, 20, 35], desc: ['-5%', '-12%', '-20%', '-35%'] },
    { id: 'harvest', stat: '核心产出', name: '自动采集', type: '经济', values: [2, 5, 10, 20], desc: ['+2/30s', '+5/30s', '+10/30s', '+20/30s'] },
    { id: 'magnet', stat: '拾取范围', name: '磁吸强化', type: '经济', values: [1, 5, 8, 10], desc: ['+1', '+5', '+8', '+10'] },
    { id: 'luck', stat: '品质概率', name: '幸运修正', type: '经济', values: [5, 12, 25, 50], desc: ['+5', '+12', '+25', '+50'] },
];

const BOSS_DEFS = [
    { id:'guardian', name:'隧道守护者', scoreTrigger:50000, hp:500, scale:3.0, color:0xff4444,
      attacks:['ring','burst','laser'], reward:5000, coresDrop:30 },
    { id:'mothership', name:'母舰核心', scoreTrigger:150000, hp:1200, scale:4.0, color:0xff44ff,
      attacks:['spiral','ring','droneSwarm'], reward:15000, coresDrop:50 },
    { id:'voidlord', name:'虚空君主', scoreTrigger:300000, hp:2500, scale:5.0, color:0x4400ff,
      attacks:['bulletHell','teleport','laser'], reward:50000, coresDrop:100 },
];

const HEAT_RANKS = [
    { rank:'D', minCombo:0,   minTime:0,   scoreMult:1.0, color:'#888888' },
    { rank:'C', minCombo:5,   minTime:15,  scoreMult:1.15, color:'#4488ff' },
    { rank:'B', minCombo:15,  minTime:30,  scoreMult:1.35, color:'#00ff88' },
    { rank:'A', minCombo:40,  minTime:60,  scoreMult:1.6,  color:'#9933ff' },
    { rank:'S', minCombo:80,  minTime:120, scoreMult:2.0,  color:'#ffd700' },
    { rank:'SS',minCombo:150, minTime:240, scoreMult:2.5,  color:'#ff4500' },
];

const WAVE_DEFS = [
    { id:1, name:'陨石带', duration:25, rocksMult:1.0, wallsMult:0.5, minesMult:0, dronesMult:0, meteorMult:1.0 },
    { id:2, name:'要塞壁', duration:25, rocksMult:0.5, wallsMult:1.5, minesMult:0.3, dronesMult:0, meteorMult:0.5 },
    { id:3, name:'雷区', duration:20, rocksMult:0.3, wallsMult:0.3, minesMult:2.0, dronesMult:0, meteorMult:0 },
    { id:4, name:'无人机中队', duration:20, rocksMult:0.5, wallsMult:0, minesMult:0.5, dronesMult:1.5, meteorMult:0 },
    { id:5, name:'综合攻势', duration:30, rocksMult:1.0, wallsMult:1.0, minesMult:1.0, dronesMult:0.5, meteorMult:1.0 },
    { id:6, name:'地狱陨石雨', duration:20, rocksMult:2.0, wallsMult:0, minesMult:0, dronesMult:0, meteorMult:2.0 },
];

const TALENT_SYNERGIES = [
    { combo:['regen','armor'], name:'不朽壁垒', effect:'受击触发1秒无敌', trigger:'onHit' },
    { combo:['dmg','crit'], name:'毁灭共鸣', effect:'暴击时范围伤害', trigger:'onCrit' },
    { combo:['fireRate','overload'], name:'超载同步', effect:'过载上限+50%，过载时火力翻倍', trigger:'passive' },
    { combo:['graze','dodge'], name:'幻影舞步', effect:'擦弹时闪避率翻倍3秒', trigger:'onGraze' },
    { combo:['maxEn','cdr'], name:'永动核心', effect:'冷却减半，回能翻倍', trigger:'passive' },
    { combo:['harvest','magnet'], name:'资源矩阵', effect:'核心掉落翻倍+全屏拾取', trigger:'passive' },
    { combo:['hp','regen'], name:'不死鸟协议', effect:'HP<30%时修复3倍', trigger:'lowHp' },
    { combo:['dmg','fireRate','crit'], name:'三位一体', effect:'10%概率3倍伤害', trigger:'onFire' },
];

const ACHIEVEMENTS_DEF = [
    { id: 'first_blood', name: '破铜烂铁', desc: '第一次坠毁。', reward: 0 },
    { id: 'first_graze', name: '生死一线', desc: '完成第一次擦弹。', reward: 5 },
    { id: 'crazy_graze', name: '刀尖跳舞', desc: '完成一次极限贴身擦弹。', reward: 10 },
    { id: 'score_20k', name: '新星起航', desc: '达到 20,000 分，解锁特殊模式与核心掉落系统。', reward: 50 },
    { id: 'score_100k', name: '超神领域', desc: '达到 100,000 分。', reward: 200 },
    { id: 'time_120', name: '耐力测试', desc: '单局存活超过 120 秒。', reward: 100 },
    { id: 'time_300', name: '不朽丰碑', desc: '单局存活超过 300 秒。', reward: 500 },
    { id: 'tier4_get', name: '终极进化', desc: '获得任意一项金色 (Tier IV) 天赋。', reward: 300 },
    { id: 'core_meteor', name: '核心猎杀者', desc: '击碎一颗极其稀有的核心陨石。', reward: 100 },
    { id: 'mech_collector', name: '机甲大亨', desc: '解锁所有机甲。', reward: 100 },
    { id: 'cores_1000', name: '核心富豪', desc: '累计获得1000个核心。', reward: 100 },
    { id: 'combo_50', name: '连击大师', desc: '达成50连击。', reward: 30 },
    { id: 'combo_100', name: '连击之神', desc: '达成100连击。', reward: 100 },
    { id: 'killstreak_20', name: '杀戮机器', desc: '连续击破20个陨石。', reward: 40 },
    { id: 'dodge_10', name: '灵巧闪避', desc: '累计触发10次闪避。', reward: 20 },
    { id: 'graze_50', name: '擦弹专家', desc: '累计擦弹50次。', reward: 50 },
    { id: 'boss_kill_1', name: 'BOSS猎手', desc: '击败第一个BOSS。', reward: 150 },
    { id: 'boss_kill_3', name: '屠龙勇士', desc: '击败全部三个BOSS。', reward: 500 },
    { id: 'rank_s', name: '炽热灵魂', desc: '达到S评价。', reward: 200 },
    { id: 'rank_ss', name: '天火降临', desc: '达到SS评价。', reward: 500 },
    { id: 'synergy_3', name: '协同共振', desc: '激活3个天赋协同。', reward: 100 },
    { id: 'synergy_5', name: '完美共鸣', desc: '激活5个天赋协同。', reward: 300 },
    { id: 'perfect_wave', name: '完美防御', desc: '无伤完成一个波次。', reward: 50 },
    { id: 'time_600', name: '永恒守望', desc: '单局存活超过600秒。', reward: 1000 },
    { id: 'score_500k', name: '得分狂潮', desc: '单局获得500,000分。', reward: 500 },
    { id: 'score_1m', name: '百万传奇', desc: '单局获得1,000,000分。', reward: 1000 },
];
