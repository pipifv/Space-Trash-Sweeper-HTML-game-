// ======================= 全局 UI 与系统方法 =======================
window.clearGameData = function() {
    if(confirm("【危险警告】这将清除所有的游戏进度、成就、分数及机甲解锁状态！该操作不可逆转！是否继续？")) {
        localStorage.clear(); location.reload();
    }
}

window.showPanel = function(id) {
    DOM.panels.forEach(p => p.classList.add('hidden'));
    if (id) {
        DOM.overlay.classList.remove('hidden');
        document.getElementById(id).classList.remove('hidden');
        if (window.customCursor) window.customCursor.setVisibility(true);
    } else {
        DOM.overlay.classList.add('hidden');
        if (window.customCursor) window.customCursor.setVisibility(false);
    }
};

window.showModeSelect = function() {
    let has20k = SAVE_DATA.achievements.includes('score_20k');
    let scBtn = document.getElementById('btn-super-core');
    let swBtn = document.getElementById('btn-sweeper');
    if (has20k) {
        scBtn.disabled = false; scBtn.innerText = '超级核心';
        swBtn.disabled = false; swBtn.innerText = '清道夫';
    } else {
        scBtn.disabled = true; scBtn.innerText = '已锁定 (需要: 20K)';
        swBtn.disabled = true; swBtn.innerText = '已锁定 (需要: 20K)';
    }
    window.showPanel('mode-select-ui');
};

window.startGame = function(modeId) {
    if (!SFX.ctx) SFX.init();
    if (window.gameInstance) window.gameInstance.destroy(); // 这里确保上一局已经完美销毁，防止任何残留重叠
    window.gameInstance = new Game(modeId);
};

window.quickRetry = function() {
    var lastMode = window.gameInstance && window.gameInstance.lastModeId;
    if (lastMode) window.startGame(lastMode);
};

window.saveSettings = function() {
    userConfig.BASE_SPEED = parseFloat(document.getElementById('cfg-basespeed').value);
    userConfig.BGM_VOLUME = parseFloat(document.getElementById('cfg-bgmvol').value);
    userConfig.OBSTACLE_DENSITY = parseFloat(document.getElementById('cfg-density').value);
    userConfig.GRAZE_DISTANCE = parseFloat(document.getElementById('cfg-grazedist').value);
    userConfig.MOUSE_SENSITIVITY = parseFloat(document.getElementById('cfg-mouse').value);

    let oldTunnel = userConfig.TUNNEL_RADIUS;
    userConfig.TUNNEL_RADIUS = parseFloat(document.getElementById('cfg-tunnel').value);
    localStorage.setItem('gameSettings', JSON.stringify(userConfig));

    CONFIG.BASE_SPEED = userConfig.BASE_SPEED; CONFIG.BGM_VOLUME = userConfig.BGM_VOLUME;
    CONFIG.OBSTACLE_DENSITY = userConfig.OBSTACLE_DENSITY; CONFIG.GRAZE_DISTANCE = userConfig.GRAZE_DISTANCE;
    CONFIG.MOUSE_SENSITIVITY = userConfig.MOUSE_SENSITIVITY;
    CONFIG.TUNNEL_RADIUS = userConfig.TUNNEL_RADIUS;

    if (SFX.masterGain) SFX.masterGain.gain.value = CONFIG.BGM_VOLUME;

    if (oldTunnel !== CONFIG.TUNNEL_RADIUS && window.gameInstance) {
        window.gameInstance.rebuildTunnel();
    }
    window.showPanel('menu');
};

// ======================= UI/成就系统辅助类 =======================
const UIHelper = {
    camera: null,
    timeoutIds: [],
    addTimeout(fn, ms) {
        const id = setTimeout(fn, ms);
        this.timeoutIds.push(id);
        return id;
    },
    clearAllTimeouts() {
        this.timeoutIds.forEach(id => clearTimeout(id));
        this.timeoutIds = [];
    },
    flashDamage() {
        const el = document.getElementById('damage-overlay'); el.style.opacity = '1';
        this.addTimeout(() => el.style.opacity = '0', 150);
    },
    showFloatingText(text, pos3D, color) {
        if(!this.camera) return;
        const pos = pos3D.clone(); pos.project(this.camera);
        const x = (pos.x * .5 + .5) * window.innerWidth, y = (pos.y * -.5 + .5) * window.innerHeight;
        const el = document.createElement('div'); el.className = 'float-text';
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`; el.style.left = 0; el.style.top = 0; el.style.color = color; el.innerText = text;
        DOM.floatingTexts.appendChild(el);
        this.addTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 1000);
    },
    logAction(text, color) {
        const el = document.createElement('div'); el.className = 'action-log-item';
        el.style.color = color; el.innerText = text;
        DOM.actionLog.prepend(el);
        this.addTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 2000);
    },
    showGrazeHint(isCrazy) {
        const el = document.getElementById(isCrazy ? 'crazy-graze-hint' : 'graze-hint');
        el.style.opacity = '0'; el.style.animation = 'none'; void el.offsetWidth;
        el.style.animation = 'grazeFlash 0.8s ease-out forwards';
    },
    showGlassShatter() {
        const el = document.getElementById('glass-shatter'); el.style.opacity = '1';
        this.addTimeout(() => { el.style.opacity = '0'; }, 1000);
    },
    showWaveAnnouncement(name, number) {
        var el = document.createElement('div');
        el.className = 'wave-announce';
        el.innerHTML = 'WAVE ' + number + '<br><span style="font-size:24px;">' + name + '</span>';
        document.body.appendChild(el);
        this.addTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
    },

    updateTotalCores() {
        document.getElementById('total-cores-lobby').innerText = `大厅总核心: ${SAVE_DATA.totalCores}`;
    },
    unlockAchievement(id) {
        if(SAVE_DATA.achievements.includes(id)) return;
        SAVE_DATA.achievements.push(id); localStorage.setItem('achievements', JSON.stringify(SAVE_DATA.achievements));
        const def = ACHIEVEMENTS_DEF.find(a => a.id === id);
        if(def) {
            if(def.reward) { SAVE_DATA.totalCores += def.reward; localStorage.setItem('totalCores', SAVE_DATA.totalCores); this.updateTotalCores(); }
            const container = DOM.toastContainer;
            const toast = document.createElement('div'); toast.className = 'toast';
            toast.innerHTML = `<div class="toast-icon">🏆</div><div class="toast-content"><h4>已解锁成就</h4><p>${def.name} ${def.reward ? `[+${def.reward} 核心]` : ''}</p></div>`;
            container.appendChild(toast);
            this.addTimeout(() => { if(toast.parentNode) toast.parentNode.removeChild(toast); }, 4000);
            this.updateAchievementsUI();
        }
    },
    updateAchievementsUI() {
        const list = document.getElementById('achievements-list'); list.innerHTML = '';
        ACHIEVEMENTS_DEF.forEach(ach => {
            const isUnlocked = SAVE_DATA.achievements.includes(ach.id);
            list.innerHTML += `
                <div class="achievement-card ${isUnlocked ? 'unlocked' : ''}">
                    <div style="flex:1;">
                        <div class="ach-title" style="font-weight:bold; margin-bottom:5px;">${ach.name} ${isUnlocked ? '✅' : '🔒'} <span style="font-size:12px;color:var(--gold); float:right;">奖励: ${ach.reward}</span></div>
                        <div style="font-size:12px; color:#aaa;">${ach.desc}</div>
                    </div>
                </div>`;
        });
    },
    updateUpgradeUI() {
        ['armor', 'engine', 'weapon'].forEach(type => {
            const lvl = SAVE_DATA.upgrades[type];
            document.getElementById(`${type}-lvl`).innerText = lvl >= 5 ? '满级' : `等级 ${lvl}`;
            const btn = document.querySelector(`.upgrade-btn[data-upgrade="${type}"]`);
            if(btn) btn.innerText = lvl >= 5 ? '满级' : `升级 (${5 * (lvl + 1)})`;
        });
        document.getElementById('magnet-lvl').innerText = `x ${SAVE_DATA.magnetCount}`;
        document.getElementById('heavy-unlock').innerText = SAVE_DATA.unlockedMechs.includes('heavy') ? '已解锁' : '解锁 (20)';
        document.getElementById('assassin-unlock').innerText = SAVE_DATA.unlockedMechs.includes('assassin') ? '已解锁' : '解锁 (20)';
        document.querySelectorAll('.mech-row').forEach(row => {
            row.classList.remove('active'); if(row.dataset.mech === SAVE_DATA.currentMech) row.classList.add('active');
        });

        const lbContainer = document.getElementById('main-leaderboard-list');
        lbContainer.innerHTML = '';
        if(SAVE_DATA.highScores.length === 0) lbContainer.innerHTML = '<p style="color:#aaa;">暂无记录。</p>';
        SAVE_DATA.highScores.forEach((entry, index) => {
            const div = document.createElement('div');
            div.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 16px;";
            let colorStr = index === 0 ? "var(--gold)" : (index === 1 ? "var(--energy)" : "var(--neon)");
            div.innerHTML = `<span style="color:${colorStr}; font-weight:bold;">No.${index+1}</span> <span style="font-weight:bold;color:#fff;">${entry.time.toFixed(1)}s <span style="font-size:12px;color:#aaa;">(总分 ${entry.score})</span></span>`;
            lbContainer.appendChild(div);
        });
        this.updateAchievementsUI();
    }
};
