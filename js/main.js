// ======================= 初始化 =======================
window.onload = () => {
    document.getElementById('cfg-basespeed').value = CONFIG.BASE_SPEED; document.getElementById('val-basespeed').innerText = CONFIG.BASE_SPEED;
    document.getElementById('cfg-bgmvol').value = CONFIG.BGM_VOLUME; document.getElementById('val-bgmvol').innerText = CONFIG.BGM_VOLUME;
    document.getElementById('cfg-density').value = CONFIG.OBSTACLE_DENSITY; document.getElementById('val-density').innerText = CONFIG.OBSTACLE_DENSITY + 'x';
    document.getElementById('cfg-grazedist').value = CONFIG.GRAZE_DISTANCE; document.getElementById('val-grazedist').innerText = CONFIG.GRAZE_DISTANCE;
    document.getElementById('cfg-mouse').value = CONFIG.MOUSE_SENSITIVITY; document.getElementById('val-mouse').innerText = CONFIG.MOUSE_SENSITIVITY;
    document.getElementById('cfg-tunnel').value = CONFIG.TUNNEL_RADIUS; document.getElementById('val-tunnel').innerText = CONFIG.TUNNEL_RADIUS;

    UIHelper.updateTotalCores();
    UIHelper.updateUpgradeUI();

    window.customCursor = new TargetCursorVanilla();
    if (!DOM.overlay.classList.contains('hidden')) {
        window.customCursor.setVisibility(true);
    } else {
        window.customCursor.setVisibility(false);
    }
};
