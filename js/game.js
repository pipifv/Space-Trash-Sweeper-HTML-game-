// ======================= 游戏主类 (严格重构防止内存泄漏) =======================
class Game {
    constructor(modeId) {
        this.disposables = [];
        this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
        this.modeId = modeId || 'novice';
        this.mode = MODES[this.modeId];

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onResize = this.onResize.bind(this);
        this.animate = this.animate.bind(this);

        this.initThree();
        this.initTunnel();
        this.initPlayer();
        this.initEntities();
        this.initPools();

        if(!this.particles) this.particles = new ParticleSystem(this.scene);
        UIHelper.camera = this.camera;

        this.objects = { walls: [], meteors: [], rocks: [], bullets: [], items: [], mines: [], drones: [], laserWalls: [] };
        this.bindEvents();
        if(!window.shopEventsBound) { this.initShopEvents(); window.shopEventsBound = true; }
        UIHelper.updateTotalCores(); UIHelper.updateUpgradeUI();

        this.start();
        this.animationId = requestAnimationFrame(this.animate);
    }

    track(res) {
        if (res && typeof res.dispose === 'function') this.disposables.push(res);
        return res;
    }

    destroy() {
        this.state.playing = false;
        if(this.animationId) cancelAnimationFrame(this.animationId);

        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onResize);

        UIHelper.clearAllTimeouts();
        SFX.stopBGM();

        this.clearScene();

        // 核心修复：必须设为 null 防止重复利用被销毁的实例导致异常渲染
        if(this.particles) {
            this.particles.dispose();
            this.particles = null;
        }

        this.safeRemove(this.tunnelGroup);
        this.safeRemove(this.ship);
        if (this.bossGroup) { this.safeRemove(this.bossGroup); this.bossGroup = null; }

        // 核心修复：必须把池中对象彻底剥离场景，防止内存泄露
        if(this.pools) {
            Object.values(this.pools).forEach(pool => {
                pool.forEach(mesh => {
                    this.safeRemove(mesh);
                });
            });
            this.pools = null;
        }

        // 彻底释放内存占用
        if (this.disposables) {
            this.disposables.forEach(d => {
                if (d && typeof d.dispose === 'function') d.dispose();
            });
            this.disposables = [];
        }

        this.objects = null;

        // 彻底清理浮动DOM元素，防止节点无限制增长
        DOM.floatingTexts.innerHTML = '';
        DOM.actionLog.innerHTML = '';
        DOM.toastContainer.innerHTML = '';
    }

    initThree() {
        if(!globalThree.renderer) {
            globalThree.scene = new THREE.Scene();
            globalThree.camera = new THREE.PerspectiveCamera(80, window.innerWidth/window.innerHeight, 0.1, 1000);

            globalThree.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
            globalThree.renderer.setSize(window.innerWidth, window.innerHeight);
            globalThree.renderer.setPixelRatio(1); // 固定分辨率比以省电、流畅
            globalThree.renderer.outputEncoding = THREE.sRGBEncoding; globalThree.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            document.body.appendChild(globalThree.renderer.domElement);

            this.invertShader = {
                uniforms: { tDiffuse: { value: null }, amount: { value: 0.0 } },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
                    void main() { vec4 color = texture2D(tDiffuse, vUv); vec3 inverted = 1.0 - color.rgb;
                    vec3 highContrast = mix(color.rgb, inverted, amount); highContrast = pow(highContrast, vec3(1.5));
                    gl_FragColor = vec4(highContrast, color.a); }`
            };

            const renderScene = new THREE.RenderPass(globalThree.scene, globalThree.camera);
            const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
            bloomPass.threshold = 0.25; bloomPass.strength = 0.7; bloomPass.radius = 0.4;

            this.fxaaPass = new THREE.ShaderPass(THREE.FXAAShader); this.fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
            this.invertPass = new THREE.ShaderPass(this.invertShader); this.invertPass.material.uniforms.amount.value = 0.0;

            globalThree.composer = new THREE.EffectComposer(globalThree.renderer);
            globalThree.composer.addPass(renderScene);
            if (!this.isMobile) globalThree.composer.addPass(bloomPass);
            globalThree.composer.addPass(this.invertPass); globalThree.composer.addPass(this.fxaaPass);

            globalThree.scene.add(new THREE.AmbientLight(0x223355, 1.5));
            const dirLight = new THREE.DirectionalLight(0xffffff, 2.0); dirLight.position.set(5, 10, 5); globalThree.scene.add(dirLight);
        }

        this.scene = globalThree.scene;
        this.camera = globalThree.camera;
        this.renderer = globalThree.renderer;
        this.composer = globalThree.composer;

        this.scene.fog = new THREE.FogExp2(0x020813, 0.003);
        this.cameraBasePos = new THREE.Vector3(0, 2, 12); this.camera.position.copy(this.cameraBasePos);
        this.cameraShake = 0;

        this.invertPass = this.composer.passes.find(p => p.material && p.material.uniforms && p.material.uniforms.amount !== undefined);
        if(this.invertPass) this.invertPass.material.uniforms.amount.value = 0.0;
    }

    initTunnel() {
        this.tunnelGroup = new THREE.Group(); this.scene.add(this.tunnelGroup); this.segments = [];
        const geo = this.track(new THREE.CylinderGeometry(CONFIG.TUNNEL_RADIUS, CONFIG.TUNNEL_RADIUS, CONFIG.SEGMENT_LEN, 12, 3, true)); geo.rotateX(Math.PI/2);
        this.darkMat = this.track(new THREE.MeshBasicMaterial({ color: 0x000308, side: THREE.BackSide }));
        this.wireMat = this.track(new THREE.MeshBasicMaterial({ color: 0x003366, wireframe: true, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending }));

        for(let i=0; i<4; i++) {
            const group = new THREE.Group(); group.add(new THREE.Mesh(geo, this.darkMat)); group.add(new THREE.Mesh(geo, this.wireMat));
            group.position.z = -i * CONFIG.SEGMENT_LEN; this.tunnelGroup.add(group); this.segments.push(group);
        }
        this.rings = []; const ringGeo = this.track(new THREE.TorusGeometry(CONFIG.TUNNEL_RADIUS - 0.2, 0.1, 8, 32));
        const ringMat = this.track(new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
        for(let i=0; i<1; i++) { const r = new THREE.Mesh(ringGeo, ringMat); r.position.z = -i * 2000; this.tunnelGroup.add(r); this.rings.push(r); }
    }

    rebuildTunnel() {
        if (this.tunnelGroup) this.safeRemove(this.tunnelGroup);
        this.initTunnel();
    }

    initPlayer() {
        this.ship = new THREE.Group(); const mechConfig = MECH_CONFIGS[SAVE_DATA.currentMech];
        this.ship.scale.setScalar(mechConfig.scale);

        const bodyMat = this.track(new THREE.MeshStandardMaterial({ color: mechConfig.color, metalness: 0.8, roughness: 0.2 }));
        const bodyGeo = this.track(new THREE.BoxGeometry(1.5, 0.5, 3));
        this.shipBody = new THREE.Mesh(bodyGeo, bodyMat); this.ship.add(this.shipBody);

        const wingGeo = this.track(new THREE.BoxGeometry(5, 0.2, 1.5));
        const wingMat = this.track(new THREE.MeshStandardMaterial({ color: mechConfig.color, metalness: 0.9 }));
        const wings = new THREE.Mesh(wingGeo, wingMat);
        wings.position.set(0, 0, 0.5); this.ship.add(wings);
        this.wingPositions = [ new THREE.Vector3(-2.5, 0, 0.5), new THREE.Vector3(2.5, 0, 0.5) ];

        const cockpitGeo = this.track(new THREE.BoxGeometry(0.8, 0.6, 1.2));
        const cockpitMat = this.track(new THREE.MeshBasicMaterial({color: mechConfig.color}));
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 0.3, -0.5); this.ship.add(cockpit);

        const flameGeo = this.track(new THREE.CylinderGeometry(0.4, 0.1, 2, 8));
        const flameMat = this.track(new THREE.MeshBasicMaterial({ color: mechConfig.color, transparent:true, blending: THREE.AdditiveBlending }));
        this.engineFlame = new THREE.Mesh(flameGeo, flameMat);
        this.engineFlame.rotateX(Math.PI/2); this.engineFlame.position.z = 2.5; this.ship.add(this.engineFlame);
        this.scene.add(this.ship);
    }

    initEntities() {
        this.geoRock = this.track(new THREE.IcosahedronGeometry(1.2, 1));
        this.rockMats = {};
        METEOR_TYPES.forEach(t => {
            this.rockMats[t.id] = this.track(new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.7, flatShading: true }));
        });

        this.meteorMats = [];
        for(let i=0; i<5; i++) this.meteorMats.push(this.track(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.2 + i*0.1, blending: THREE.AdditiveBlending})));
        this.meteorMatSweeper = this.track(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending}));
        this.geoMeteor = this.track(new THREE.CylinderGeometry(0.02, 0.02, 1, 4));
        this.geoMeteor.rotateX(Math.PI / 2);

        this.geoGold = this.track(new THREE.OctahedronGeometry(0.8));
        this.matGold = this.track(new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0x886600, metalness:1 }));
        this.matPower = this.track(new THREE.MeshBasicMaterial({color:0xff44ff}));
        this.matDouble = this.track(new THREE.MeshBasicMaterial({color:0x9933ff, wireframe: true}));
        this.matEnergy = this.track(new THREE.MeshBasicMaterial({color:0x00ff88}));

        this.matWall = this.track(new THREE.MeshBasicMaterial({ color: 0x004488, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        this.geoLaser = this.track(new THREE.CylinderGeometry(0.1, 0.1, 4, 8)); this.geoLaser.rotateX(Math.PI/2);
        this.matLaser = this.track(new THREE.MeshBasicMaterial({ color: 0xffddaa }));

        let shapePad = new THREE.Shape();
        shapePad.moveTo(-2, 1); shapePad.lineTo(0, 0); shapePad.lineTo(-2, -1);
        shapePad.lineTo(-1, -1); shapePad.lineTo(1, 0); shapePad.lineTo(-1, 1);
        this.geoPad = this.track(new THREE.ExtrudeGeometry(shapePad, { depth: 0.5, bevelEnabled: false }));
        this.matPad = this.track(new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true }));
    }

    initPools() {
        this.pools = { rocks: [], bullets: [], meteors: [], items: [], mines: [], drones: [], laserWalls: [] };
        for(let i=0; i<150; i++) { let r = new THREE.Mesh(this.geoRock, this.rockMats[0]); r.visible = false; this.scene.add(r); this.pools.rocks.push(r); }
        for(let i=0; i<50; i++) { let l = new THREE.Mesh(this.geoLaser, this.matLaser); l.visible = false; this.scene.add(l); this.pools.bullets.push(l); }
        for(let i=0; i<50; i++) { let m = new THREE.Mesh(this.geoGold, this.matGold); m.visible = false; this.scene.add(m); this.pools.items.push(m); }
        for(let i=0; i<20; i++) { let m = new THREE.Mesh(this.geoMeteor, this.meteorMats[0]); m.visible = false; this.scene.add(m); this.pools.meteors.push(m); }
        for(let i=0; i<15; i++) { let d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({color:0xff4400})); d.visible = false; this.scene.add(d); this.pools.drones.push(d); }
        for(let i=0; i<30; i++) { let m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({color:0xff2222})); m.visible = false; this.scene.add(m); this.pools.mines.push(m); }
        for(let i=0; i<10; i++) { let lw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 25, 2), new THREE.MeshBasicMaterial({color:0xff6600, transparent:true, opacity:0.7})); lw.visible = false; this.scene.add(lw); this.pools.laserWalls.push(lw); }
    }

    getPooled(type, createFn) {
        let pool = this.pools[type];
        for(let i=0; i<pool.length; i++) {
            if(!pool[i].visible) { pool[i].visible = true; return pool[i]; }
        }
        let obj = createFn(); pool.push(obj); return obj;
    }

    releasePooled(type, obj) { obj.visible = false; obj.position.set(0, 0, 1000); }

    initShopEvents() {
        document.querySelectorAll('.upgrade-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.upgrade;
                if(type === 'magnet') {
                    if(SAVE_DATA.totalCores >= 20) { SAVE_DATA.totalCores -= 20; SAVE_DATA.magnetCount++; localStorage.setItem('totalCores', SAVE_DATA.totalCores); localStorage.setItem('magnetCount', SAVE_DATA.magnetCount); }
                } else {
                    if(SAVE_DATA.upgrades[type] < 5) {
                        const cost = 5 * (SAVE_DATA.upgrades[type] + 1);
                        if(SAVE_DATA.totalCores >= cost) { SAVE_DATA.totalCores -= cost; SAVE_DATA.upgrades[type]++; localStorage.setItem('totalCores', SAVE_DATA.totalCores); localStorage.setItem(`upgrade_${type}`, SAVE_DATA.upgrades[type]); }
                    }
                }
                UIHelper.updateTotalCores(); UIHelper.updateUpgradeUI();
            });
        });

        document.querySelectorAll('.mech-row').forEach(row => {
            row.addEventListener('click', () => {
                const mech = row.dataset.mech;
                if(SAVE_DATA.unlockedMechs.includes(mech)) {
                    SAVE_DATA.currentMech = mech; localStorage.setItem('currentMech', mech); UIHelper.updateUpgradeUI();
                    if(window.gameInstance && !window.gameInstance.state.playing) { window.gameInstance.safeRemove(window.gameInstance.ship); window.gameInstance.initPlayer(); }
                } else if(SAVE_DATA.totalCores >= 20) {
                    SAVE_DATA.totalCores -= 20; SAVE_DATA.unlockedMechs.push(mech);
                    localStorage.setItem('totalCores', SAVE_DATA.totalCores); localStorage.setItem('unlockedMechs', JSON.stringify(SAVE_DATA.unlockedMechs));
                    UIHelper.updateTotalCores(); UIHelper.updateUpgradeUI();
                    if(SAVE_DATA.unlockedMechs.length >= 3) UIHelper.unlockAchievement('mech_collector');
                }
            });
        });
    }

    safeRemove(obj) {
        if(!obj) return;
        if(obj.parent) obj.parent.remove(obj);
        if(obj.isMesh) {
            if(obj.geometry && obj.userData.disposeGeo) obj.geometry.dispose();
            if(obj.material && obj.userData.disposeMat) {
                if(Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }
        if(obj.children) {
            let children = [...obj.children];
            children.forEach(c => this.safeRemove(c));
        }
    }

    clearScene() {
        if(!this.objects) return;
        ['walls', 'meteors', 'rocks', 'bullets', 'items', 'mines', 'drones', 'laserWalls'].forEach(arr => {
            if(this.objects[arr]) {
                this.objects[arr].forEach(obj => {
                    if (arr === 'walls' || obj.userData.isPad) this.safeRemove(obj);
                    else this.releasePooled(arr, obj);
                });
                this.objects[arr] = [];
            }
        });
    }

    spawnWall() {
        const closedAngle = Math.PI + Math.random() * (Math.PI * 0.66);
        const safeMid = this.state.safeWallAngle;
        const startAngle = safeMid + Math.PI/4 + Math.random() * (Math.PI * 1.5 - closedAngle);

        const shape = new THREE.Shape();
        shape.moveTo(0,0);
        shape.absarc(0, 0, 14*0.75, startAngle, startAngle + closedAngle);
        shape.lineTo(0,0);

        const geo = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
        const wall = new THREE.Mesh(geo, this.matWall);
        wall.position.z = -400;
        wall.userData = {
            isWall: true,
            startAngle: startAngle,
            closedAngle: closedAngle,
            radius: 14 * 0.75,
            disposeGeo: true,
            passed: false
        };
        this.scene.add(wall);
        this.objects.walls.push(wall);
    }

    spawnRock(isSweeper = false) {
        if(Date.now() < this.state.coreStringUntil && !isSweeper) return;
        const angle = Math.random() * Math.PI * 2, radius = Math.random() * (CONFIG.TUNNEL_RADIUS - 2);
        let rock = this.getPooled('rocks', () => { let r = new THREE.Mesh(this.geoRock, this.rockMats[0]); this.scene.add(r); return r; });

        let mType = METEOR_TYPES[0];
        let rand = Math.random();
        if(rand > 0.98) mType = METEOR_TYPES[5];
        else if(rand > 0.95) mType = METEOR_TYPES[4];
        else if(rand > 0.85) mType = METEOR_TYPES[3];
        else if(rand > 0.65) mType = METEOR_TYPES[2];
        else if(rand > 0.35) mType = METEOR_TYPES[1];

        rock.material = this.rockMats[mType.id];
        rock.position.set(Math.cos(angle)*radius, Math.sin(angle)*radius, -400); rock.rotation.set(Math.random(), Math.random(), Math.random());
        const s = 0.6 + Math.random()*1.8; rock.scale.set(s,s,s);

        rock.userData = { radius: 1.2 * s, type: mType, hp: 10 * mType.hpMult, grazed: false, isSweeper: isSweeper, vx: 0, vy: 0 };
        this.objects.rocks.push(rock);
    }

    spawnCoreString() {
        SFX.coreString(); this.state.coreStringUntil = Date.now() + CONFIG.CORE_STRING_DURATION;
        for(let i=0; i<20; i++) {
            const pos = new THREE.Vector3(Math.sin(i * 0.5) * 10, Math.cos(i * 0.5) * 5, -100 - i * 10);
            this.spawnItem('gold', pos);
        }
    }

    spawnMineCluster() {
        var self = this;
        var angle = Math.random() * Math.PI * 2;
        var radius = 3 + Math.random() * 4;
        var centerMine = this.getPooled('mines', () => { var m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({color:0xff2222})); self.scene.add(m); return m; });
        centerMine.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -300);
        centerMine.scale.set(1.5, 1.5, 1.5);
        centerMine.userData = { isMine: true, isCenter: true, armed: false, armedAt: Date.now() + 1500, hp: 5 };
        this.objects.mines.push(centerMine);
        var childCount = 4 + Math.floor(Math.random() * 5);
        for (var i = 0; i < childCount; i++) {
            var ca = (i / childCount) * Math.PI * 2 + Math.random() * 0.3;
            var cr = 2 + Math.random() * 3;
            var child = this.getPooled('mines', () => { var m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), new THREE.MeshBasicMaterial({color:0xff4444})); self.scene.add(m); return m; });
            child.position.set(centerMine.position.x + Math.cos(ca) * cr, centerMine.position.y + Math.sin(ca) * cr, centerMine.position.z + (Math.random() - 0.5) * 4);
            child.scale.set(0.5, 0.5, 0.5);
            child.userData = { isMine: true, isChild: true, parent: centerMine, armed: false, armedAt: Date.now() + 1500, hp: 3 };
            this.objects.mines.push(child);
        }
    }

    spawnLaserWall() {
        if (this.objects.laserWalls.length >= 3) return;
        var self = this;
        var lw = this.getPooled('laserWalls', () => { var m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 25, 2), new THREE.MeshBasicMaterial({color:0xff6600, transparent:true, opacity:0.7})); self.scene.add(m); return m; });
        var angle = Math.random() * Math.PI * 2;
        var dist = 3 + Math.random() * (CONFIG.TUNNEL_RADIUS - 6);
        lw.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, -300);
        lw.rotation.z = angle;
        lw.userData = { isLaserWall: true, angle: angle, dist: dist, rotSpeed: 1 + Math.random() * 3, spawnedAt: Date.now(), lifetime: 8000, passed: false };
        this.objects.laserWalls.push(lw);
    }

    spawnDrone() {
        if (this.objects.drones.length >= 5) return;
        var self = this;
        var drone = this.getPooled('drones', () => { var g = new THREE.IcosahedronGeometry(0.5, 0); var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color:0xff4400})); self.scene.add(m); return m; });
        drone.position.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 15, -300);
        drone.userData = { isDrone: true, hp: 15, homingStrength: 0.01 + Math.random() * 0.02, passed: false };
        this.objects.drones.push(drone);
    }

    spawnGoldPattern() {
        let type = Math.floor(Math.random()*3); let startZ = -300;
        if (type === 0) {
            for(let i=0; i<15; i++) {
                let angle = i * 0.5; let radius = 5 + Math.sin(i*0.2)*2;
                this.spawnItem('gold', new THREE.Vector3(Math.cos(angle)*radius, Math.sin(angle)*radius, startZ - i*10));
            }
        } else if (type === 1) {
            for(let i=0; i<8; i++) this.spawnItem('gold', new THREE.Vector3(0, 0, startZ - i*12));
        } else {
            for(let i=0; i<5; i++) {
                this.spawnItem('gold', new THREE.Vector3(i*2, i*1.5, startZ - i*10));
                if(i>0) this.spawnItem('gold', new THREE.Vector3(-i*2, i*1.5, startZ - i*10));
            }
        }
    }

    spawnMeteor() {
        let mat = this.modeId === 'sweeper' ? this.meteorMatSweeper : this.meteorMats[Math.floor(Math.random()*this.meteorMats.length)];
        let m = this.getPooled('meteors', () => { let mesh = new THREE.Mesh(this.geoMeteor, mat); this.scene.add(mesh); return mesh; });
        m.material = mat;
        m.scale.z = 15 + Math.random()*15;
        m.position.set((Math.random()-0.5)*150, (Math.random()-0.5)*100, -500 - Math.random()*100);
        m.rotation.y = (Math.random()-0.5)*0.1; m.rotation.x = (Math.random()-0.5)*0.1;
        m.userData = { speed: 40 + Math.random()*30 };
        this.objects.meteors.push(m);
    }

    spawnItem(type, customPos = null) {
        let mat = this.matGold; if (type === 'power') mat = this.matPower; else if (type === 'double_score') mat = this.matDouble; else if (type === 'energy') mat = this.matEnergy;
        let mesh = this.getPooled('items', () => { let m = new THREE.Mesh(this.geoGold, mat); this.scene.add(m); return m; });
        mesh.geometry = this.geoGold; mesh.material = mat;
        if(customPos) mesh.position.copy(customPos); else mesh.position.set((Math.random()-0.5)*15, (Math.random()-0.5)*15, -400);
        mesh.userData = { type };
        this.objects.items.push(mesh);
    }

    spawnSpringboard() {
        let pad = new THREE.Mesh(this.geoPad, this.matPad);
        pad.position.set((Math.random()-0.5)*15, (Math.random()-0.5)*15, -400);
        pad.userData = { isPad: true };
        this.scene.add(pad); this.objects.items.push(pad);
    }

    activateSkill() {
        const now = Date.now();
        if (now < this.state.skillCooldownUntil) return;

        let mech = SAVE_DATA.currentMech;
        let cdr = 1.0 - (this.state.stats.cdr / 100);
        if (mech === 'default') {
            if (this.state.energy < 40) return;
            this.state.energy -= 40; this.state.activeSkill = 'spread'; this.state.skillActiveUntil = now + 3000; this.state.skillCooldownUntil = now + 20000 * cdr;
            UIHelper.showFloatingText('过载散布！', this.ship.position, '#00e5ff');
        } else if (mech === 'heavy') {
            if (this.state.energy < 50) return;
            this.state.energy -= 50; this.state.activeSkill = 'ironWall'; this.state.skillActiveUntil = now + 3000; this.state.skillCooldownUntil = now + 20000 * cdr;
            this.shipBody.material.emissive.setHex(0xffd700); UIHelper.showFloatingText('铁壁！', this.ship.position, '#ffd700');
        } else if (mech === 'assassin') {
            if (this.state.energy < 30) return;
            this.state.energy -= 30; this.state.activeSkill = 'blink'; this.state.skillCooldownUntil = now + 12000 * cdr;

            const targetX = this.state.mouseX * CONFIG.TUNNEL_RADIUS, targetY = this.state.mouseY * CONFIG.TUNNEL_RADIUS;
            let dx = targetX - this.ship.position.x, dy = targetY - this.ship.position.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 15) { dx *= 15/dist; dy *= 15/dist; }
            this.ship.position.x += dx; this.ship.position.y += dy;

            this.state.invincibleUntil = Math.max(this.state.invincibleUntil, now + 1000);
            this.particles.explode(this.ship.position, 0x9933ff, 20); UIHelper.showFloatingText('暗影步！', this.ship.position, '#9933ff');
        }
    }

    activateBulletTime() {
        const now = Date.now();
        if(this.state.energy < 100 || this.state.bulletTimeActive || this.state.isRampage || now < this.state.invincibleUntil || this.state.activeSkill === 'ironWall') return;
        this.state.bulletTimeActive = true; this.state.bulletTimeUntil = now + CONFIG.BULLET_TIME_DURATION;
        this.state.energy -= 100; SFX.bulletTime();
        this.invertPass.material.uniforms.amount.value = 1.0;

        let cleared = false;
        ['walls', 'rocks'].forEach(arr => {
            if (!this.objects[arr]) return;
            for(let i=this.objects[arr].length-1; i>=0; i--) {
                let obj = this.objects[arr][i];
                let dz = this.ship.position.z - obj.position.z;
                if (dz > 0 && dz < 150) {
                    let dx = obj.position.x - this.ship.position.x; let dy = obj.position.y - this.ship.position.y;
                    let dist = Math.sqrt(dx*dx + dy*dy); let angle = Math.atan2(dist, dz);
                    if (angle < Math.PI / 6) {
                        this.particles.explode(obj.position, 0xffffff, 10);
                        if(arr === 'walls') this.safeRemove(obj); else this.releasePooled(arr, obj);
                        this.objects[arr].splice(i, 1); cleared = true;
                    }
                }
            }
        });
        if(cleared) SFX.glassShatter();
    }

    fire() {
        if (this.state.activeSkill === 'ironWall') return;

        const now = Date.now();
        const fireInterval = 150 / (1 + this.state.stats.fireRate / 100);
        if(now - (this.state.lastFireTime || 0) < fireInterval) return;
        this.state.lastFireTime = now;

        const energyCost = Math.max(2, 10 - SAVE_DATA.upgrades.weapon * 2);
        if(this.state.energy < energyCost && this.modeId !== 'sweeper') return;
        if(this.modeId !== 'sweeper') this.state.energy -= energyCost;
        SFX.shoot(); this.cameraShake = 0.1;

        let isSpread = this.state.activeSkill === 'spread';
        let comboBonus = this.state.combo >= 50 ? 2 : (this.state.combo >= 20 ? 1 : 0);
        let shotCount = isSpread ? 5 : 2 + comboBonus;

        for (let i = 0; i < shotCount; i++) {
            let laser = this.getPooled('bullets', () => { let l = new THREE.Mesh(this.geoLaser, this.matLaser); this.scene.add(l); return l; });
            laser.position.copy(this.ship.position);

            let spreadWidth = (shotCount - 1) * 0.8;
            let offset = (i * 0.8) - (spreadWidth / 2);

            laser.position.x += offset;
            laser.userData.vx = isSpread ? offset * 0.1 : offset * 0.05;
            laser.userData.pierce = (isSpread || comboBonus >= 2) ? 1 : 0;

            let baseDmg = 10;
            let finalDmg = baseDmg * (1 + this.state.stats.dmg / 100);
            if (Math.random() * 100 < this.state.stats.crit) {
                finalDmg *= 2;
                if (this.state.activeSynergies['毁灭共鸣']) { finalDmg *= 1.5; }
            }
            if (this.state.activeSynergies['三位一体'] && Math.random() < 0.1) {
                finalDmg *= 3; UIHelper.showFloatingText('三位一体!', this.ship.position, '#ffd700');
            }
            laser.userData.damage = finalDmg;

            laser.position.z -= 1.5;
            this.objects.bullets.push(laser);
        }
    }

    incrementCombo(amt = 1) {
        let actualAmt = amt; if(SAVE_DATA.currentMech === 'assassin') actualAmt *= 2;
        this.state.combo += actualAmt; this.state.comboTimer = 2.0;
        this.state.comboPeak = Math.max(this.state.comboPeak, this.state.combo);
        this.state.killStreak++; this.state.killStreakTimer = 3.0;
        if (this.state.killStreak >= 20) UIHelper.unlockAchievement('killstreak_20');
        DOM.comboVal.innerText = 'x' + this.state.combo;
        DOM.comboVal.style.transform = 'scale(1.5)';
        UIHelper.addTimeout(() => { DOM.comboVal.style.transform = 'scale(1)'; }, 100);
        if (this.state.combo > 0 && this.state.combo % 10 === 0) this.state.dynamicDensityMultiplier = Math.min(1.5, this.state.dynamicDensityMultiplier + 0.05);
        if (this.state.combo >= 100) UIHelper.unlockAchievement('combo_100');
        else if (this.state.combo >= 50) UIHelper.unlockAchievement('combo_50');
    }

    computeHeatRank() {
        var prev = this.state.heatRank;
        for (var i = HEAT_RANKS.length - 1; i >= 0; i--) {
            if (this.state.comboPeak >= HEAT_RANKS[i].minCombo && this.state.time >= HEAT_RANKS[i].minTime) {
                this.state.heatRank = i; break;
            }
        }
        if (this.state.heatRank !== prev && this.state.heatRank > 0) {
            var r = HEAT_RANKS[this.state.heatRank];
            if (this.ship && this.ship.position) UIHelper.showFloatingText('Rank Up: ' + r.rank, this.ship.position, r.color);
            if (r.rank === 'S') UIHelper.unlockAchievement('rank_s');
            if (r.rank === 'SS') UIHelper.unlockAchievement('rank_ss');
            SFX.rankUp && SFX.rankUp();
        }
        this.state.heatRankPrev = this.state.heatRank;
    }

    updateWaves(now, dt) {
        if (this.state.bossActive || this.mode.type === 'special') return;
        if (this.state.time < 15) return;

        if (!this.state.isWaveActive) {
            if (now < this.state.waveGraceUntil) return;
            this.state.currentWave++;
            this.state.isWaveActive = true;
            this.state.waveStartTime = now;
            var waveIdx = (this.state.currentWave - 1) % WAVE_DEFS.length;
            var waveDef = WAVE_DEFS[waveIdx];
            this.state.waveDuration = waveDef.duration * 1000;
            this.state.waveComposition = waveDef;
            this.state.waveDamageTaken = 0;
            UIHelper.showWaveAnnouncement && UIHelper.showWaveAnnouncement(waveDef.name, this.state.currentWave);
            UIHelper.logAction('第' + this.state.currentWave + '波: ' + waveDef.name, '#ff8800');
            SFX.waveStart && SFX.waveStart();
        } else {
            if (now - this.state.waveStartTime >= this.state.waveDuration) {
                this.state.isWaveActive = false;
                this.state.waveComposition = null;
                this.state.waveGraceUntil = now + 5000;
                this.state.wavesCompleted++;
                UIHelper.logAction('波次完成!', '#00ff88');
                if (this.state.waveDamageTaken === 0) UIHelper.unlockAchievement('perfect_wave');
            }
        }
    }

    checkBossTrigger() {
        if (this.state.bossActive || this.mode.type === 'special') return;
        var totalScore = Math.floor(this.state.time * 100 * 0.4 + this.state.actionScore * 0.6) * HEAT_RANKS[this.state.heatRank].scoreMult;
        for (var i = 0; i < BOSS_DEFS.length; i++) {
            var def = BOSS_DEFS[i];
            if (totalScore >= def.scoreTrigger && !this.state.defeatedBosses.includes(def.id)) {
                this.spawnBoss(def); break;
            }
        }
    }

    spawnBoss(def) {
        this.state.bossActive = true; this.state.bossDef = def; this.state.bossHp = def.hp;
        this.state.bossMaxHp = def.hp; this.state.bossPhase = 1; this.state.bossPhaseTimer = 0;
        this.state.bossAttackTimer = 0; this.state.bossNextAttack = 2000;
        if (!this.bossGroup) {
            this.bossGroup = new THREE.Group();
            var bodyGeo = new THREE.IcosahedronGeometry(def.scale, 1);
            var bodyMat = new THREE.MeshPhongMaterial({color: def.color, emissive: def.color, emissiveIntensity: 0.5});
            this.bossBody = new THREE.Mesh(bodyGeo, bodyMat); this.bossGroup.add(this.bossBody);
            var ringGeo = new THREE.TorusGeometry(def.scale * 0.8, 0.3, 16, 32);
            var ringMat = new THREE.MeshBasicMaterial({color: def.color});
            var ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; this.bossGroup.add(ring);
            var coreGeo = new THREE.SphereGeometry(def.scale * 0.3, 16, 16);
            var coreMat = new THREE.MeshBasicMaterial({color: 0xffffff});
            var core = new THREE.Mesh(coreGeo, coreMat); this.bossGroup.add(core);
            this.scene.add(this.bossGroup);
        }
        this.bossBody.material.color.setHex(def.color);
        this.bossBody.material.emissive.setHex(def.color);
        this.bossBody.scale.set(1, 1, 1);
        this.bossGroup.position.set(0, 0, -60);
        this.bossGroup.visible = true;
        DOM.bossHud.classList.remove('hidden');
        DOM.bossName.innerText = def.name;
        DOM.bossName.style.color = '#' + def.color.toString(16).padStart(6, '0');
        DOM.bossHpFill.style.width = '100%';
        SFX.bossWarning && SFX.bossWarning();
        UIHelper.logAction('BOSS 来袭: ' + def.name, '#ff0000');
    }

    updateBoss(now, dt) {
        if (!this.state.bossActive || !this.bossGroup) return;
        var def = this.state.bossDef;
        this.bossGroup.position.z += this.currentSpeed * 0.3 * dt;
        this.bossGroup.rotation.y += 0.3 * dt;
        this.bossBody.rotation.x += 0.5 * dt;

        if (this.bossGroup.position.z > this.ship.position.z + 5) this.bossGroup.position.z = this.ship.position.z - 5;
        if (this.bossGroup.position.z < this.ship.position.z - 30) this.bossGroup.position.z = this.ship.position.z - 20;

        this.state.bossPhaseTimer += dt * 1000;
        this.state.bossAttackTimer += dt * 1000;

        if (this.state.bossHp < this.state.bossMaxHp * 0.5 && this.state.bossPhase < 2) {
            this.state.bossPhase = 2;
            this.bossBody.material.emissiveIntensity = 1.0;
            UIHelper.logAction(def.name + ' 进入狂暴阶段!', '#ff0000');
        }

        var attackInterval = this.state.bossPhase === 2 ? 1500 : 2500;
        if (this.state.bossAttackTimer >= attackInterval) {
            this.state.bossAttackTimer = 0;
            var attacks = def.attacks;
            var attack = attacks[Math.floor(Math.random() * attacks.length)];
            this.bossAttack(attack, now);
        }

        DOM.bossHpFill.style.width = Math.max(0, (this.state.bossHp / this.state.bossMaxHp) * 100) + '%';
    }

    bossAttack(type, now) {
        var def = this.state.bossDef;
        var z = this.bossGroup.position.z;
        var count = this.state.bossPhase === 2 ? 16 : 10;
        switch (type) {
            case 'ring':
                for (var i = 0; i < count; i++) {
                    var angle = (i / count) * Math.PI * 2;
                    var r = this.getPooled('rocks', () => { var m = new THREE.Mesh(this.geoRock, this.rockMats[0]); this.scene.add(m); return m; });
                    r.material = this.rockMats[0];
                    r.position.set(Math.cos(angle) * 8, Math.sin(angle) * 8, z);
                    r.userData = { hp: 3, radius: 1, type: METEOR_TYPES[0], isBossProj: true, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3 };
                    r.visible = true; this.objects.rocks.push(r);
                }
                break;
            case 'burst':
                for (var i = 0; i < 8; i++) {
                    var angle = (i / 8) * Math.PI * 2;
                    var b = this.getPooled('bullets', () => { var m = new THREE.Mesh(this.geoLaser, new THREE.MeshBasicMaterial({color:0xff0000})); this.scene.add(m); return m; });
                    b.position.set(this.bossGroup.position.x, this.bossGroup.position.y, z);
                    b.userData = { vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2, pierce: 0, damage: 25, isBossBullet: true };
                    b.visible = true; this.objects.bullets.push(b);
                }
                break;
            case 'laser':
                var lw = this.getPooled('laserWalls', () => { var m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 30, 2), new THREE.MeshBasicMaterial({color:0xff0000, transparent:true, opacity:0.9})); this.scene.add(m); return m; });
                lw.position.copy(this.bossGroup.position);
                lw.userData = { isLaserWall: true, angle: 0, dist: 5, rotSpeed: 4, spawnedAt: Date.now(), lifetime: 5000, passed: false, isBossLaser: true };
                lw.visible = true; this.objects.laserWalls.push(lw);
                break;
            case 'spiral':
                for (var i = 0; i < 14; i++) {
                    var sa = (i / 14) * Math.PI * 4 + now * 0.001;
                    var r = this.getPooled('rocks', () => { var m = new THREE.Mesh(this.geoRock, this.rockMats[0]); this.scene.add(m); return m; });
                    r.position.set(Math.cos(sa) * (4 + i * 0.5), Math.sin(sa) * (4 + i * 0.5), z - i);
                    r.userData = { hp: 2, radius: 0.8, type: METEOR_TYPES[0], isBossProj: true, vx: Math.cos(sa) * 1.5, vy: Math.sin(sa) * 1.5 };
                    r.visible = true; this.objects.rocks.push(r);
                }
                break;
            case 'droneSwarm':
                for (var i = 0; i < 5; i++) {
                    var drone = this.getPooled('drones', () => { var g = new THREE.IcosahedronGeometry(0.4, 0); var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color:0xff44ff})); this.scene.add(m); return m; });
                    drone.position.set(this.bossGroup.position.x + (Math.random()-0.5)*10, this.bossGroup.position.y + (Math.random()-0.5)*8, z);
                    drone.userData = { isDrone: true, hp: 8, homingStrength: 0.03, passed: false, isBossDrone: true };
                    drone.visible = true; this.objects.drones.push(drone);
                }
                break;
            case 'bulletHell':
                for (var i = 0; i < 30; i++) {
                    var ba = (i / 30) * Math.PI * 2;
                    var b = this.getPooled('bullets', () => { var m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 4, 4), new THREE.MeshBasicMaterial({color:0xff00ff})); this.scene.add(m); return m; });
                    b.position.copy(this.bossGroup.position);
                    b.userData = { vx: Math.cos(ba) * (1 + Math.random()*4), vy: Math.sin(ba) * (1 + Math.random()*4), pierce: 0, damage: 25, isBossBullet: true };
                    b.visible = true; this.objects.bullets.push(b);
                }
                break;
            case 'teleport':
                this.bossGroup.position.set((Math.random()-0.5)*15, (Math.random()-0.5)*10, this.ship.position.z - 20);
                this.particles.explode(this.bossGroup.position, def.color, 20, 2.0);
                break;
        }
    }

    defeatBoss() {
        var def = this.state.bossDef;
        this.state.actionScore += def.reward * this.rankMult;
        this.state.gold += def.coresDrop;
        this.state.bossActive = false;
        this.state.defeatedBosses.push(def.id);
        if (this.bossGroup) this.bossGroup.visible = false;
        DOM.bossHud.classList.add('hidden');
        this.particles.explode(this.bossGroup ? this.bossGroup.position : this.ship.position, def.color, 40, 3.0);
        SFX.bossDefeat && SFX.bossDefeat();
        UIHelper.logAction(def.name + ' 已被击破! +' + def.coresDrop + '核心', '#ffd700');
        UIHelper.unlockAchievement('boss_kill_1');
        if (this.state.defeatedBosses.length >= 3) UIHelper.unlockAchievement('boss_kill_3');
        for (var i = 0; i < def.coresDrop; i++) {
            this.spawnItem('gold', new THREE.Vector3((Math.random()-0.5)*12, (Math.random()-0.5)*8, this.bossGroup ? this.bossGroup.position.z + Math.random()*10 : -50));
        }
    }

    togglePause() {
        if(!this.state.playing || this.state.hp <= 0) return;
        this.state.paused = !this.state.paused;
        if(this.state.paused) {
            this.updatePauseStats();
            window.showPanel('pause-ui');
            if (SFX.masterGain) SFX.masterGain.gain.value = 0;
        } else {
            window.showPanel(null);
            if (SFX.masterGain) SFX.masterGain.gain.value = CONFIG.BGM_VOLUME;
            this.lastTime = Date.now();
        }
    }

    updatePauseStats() {
        const stats = this.state.stats;
        document.getElementById('pause-stats').innerHTML = `
            最大装甲: ${Math.floor(this.getMaxHP())} <br>
            纳米修复: ${stats.regen}/s <br>
            紧急避险: ${stats.dodge}% <br>
            护甲减伤: ${stats.armor} <br>
            弹道威力: +${stats.dmg}% <br>
            射频增压: +${stats.fireRate}% <br>
            暴击概率: ${stats.crit}% <br>
            产热降低: ${stats.overload}% <br>
            冷却缩减: ${stats.cdr}%
        `;
        let talentStr = '';
        if(this.state.talents.length === 0) talentStr = '暂无模块';
        this.state.talents.forEach(t => {
            let color = `var(--tier${t.tier})`;
            talentStr += `<div style="color:${color}; margin-bottom:5px;">[T${t.tier}] ${t.name} ${t.valDesc}</div>`;
        });
        document.getElementById('pause-talents').innerHTML = talentStr;
    }

    quitGame() {
        this.state.paused = false; if (SFX.masterGain) SFX.masterGain.gain.value = CONFIG.BGM_VOLUME;
        this.state.hp = 0; this.die();
    }

    onMouseMove(e) {
        let rawX = (e.clientX / window.innerWidth) * 2 - 1;
        let rawY = -(e.clientY / window.innerHeight) * 2 + 1;
        let sensMult = CONFIG.MOUSE_SENSITIVITY / 5.0;
        this.state.mouseX = Math.max(-1, Math.min(1, rawX * sensMult));
        this.state.mouseY = Math.max(-1, Math.min(1, rawY * sensMult));
    }
    onMouseDown() { if(this.state.playing && !this.state.paused) this.state.isBoosting = true; }
    onMouseUp() { this.state.isBoosting = false; }
    onKeyDown(e) {
        if(e.code === 'Escape') this.togglePause();
        if(!this.state.playing || this.state.paused) return;
        if(e.code === 'Space') this.fire();
        if(e.code === 'KeyQ') this.activateBulletTime();
        if(e.code === 'KeyE') this.activateSkill();
    }
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight); this.composer.setSize(window.innerWidth, window.innerHeight);
        this.fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
    }

    bindEvents() {
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onResize);
    }

    getMaxHP() {
        const base = 100 * MECH_CONFIGS[SAVE_DATA.currentMech].hp * (1 + SAVE_DATA.upgrades.armor * 0.2);
        return base + this.state.stats.hp;
    }

    start() {
        window.showPanel(null); this.clearScene();

        let hasMagnet = false;
        if(SAVE_DATA.magnetCount > 0) {
            SAVE_DATA.magnetCount--; localStorage.setItem('magnetCount', SAVE_DATA.magnetCount);
            hasMagnet = true; UIHelper.updateUpgradeUI();
        }

        this.state = {
            playing: true, paused: false, time: 0, lastSecCheck: 0, actionScore: 0, gold: 0, combo: 0,
            overload: 0, hp: 0, energy: 100,
            invincibleUntil: 0, bulletTimeUntil: 0, bulletTimeActive: false,
            comboTimer: 0, comboGraceUntil: 0, comboPunishment: 0, comboPeak: 0, heatRank: 0, heatRankPrev: 0,
            killStreak: 0, killStreakTimer: 0, coreStringUntil: 0, currentBiome: 'default', tunnelRotation: 0,
            mouseX: 0, mouseY: 0, hasMagnet: hasMagnet, safeWallAngle: 0, safeAngleTimer: 0,
            isRampage: false, rampageUntil: 0, overloadCooldownUntil: 0, overloadDecayTimer: 0,
            doubleScoreUntil: 0, dynamicDensityMultiplier: 1.0, nextSafeTunnelTime: 40 + Math.random()*10,
            safeTunnelUntil: 0, stunUntil: 0, lastHitTime: 0, springboardUntil: 0,
            activeSkill: null, skillActiveUntil: 0, skillCooldownUntil: 0, harvestTimer: 0, lastDamageCause: '',
            activeSynergies: {},
            bossActive: false, bossDef: null, bossHp: 0, bossMaxHp: 0, bossPhase: 0,
            bossPhaseTimer: 0, bossAttackTimer: 0, bossNextAttack: 0, bossArena: false, defeatedBosses: [],
            currentWave: 0, waveStartTime: 0, waveDuration: 0, isWaveActive: false,
            waveComposition: null, wavesCompleted: 0, waveGraceUntil: 0, waveDamageTaken: 0,
            nextRoguelikeLevel: 1, talents: [], talentRecords: {},
            stats: { hp: 0, regen: 0, dodge: 0, armor: 0, dmg: 0, fireRate: 0, crit: 0, overload: 0, maxEn: 100, graze: 0, cdr: 0, harvest: 0, magnet: 0, luck: 0 },
            rerollCount: 0
        };
        this.state.hp = this.getMaxHP();
        this.state.missionDuration = (this.mode.type === 'special') ? 30 : 0;

        DOM.modeVal.innerText = this.mode.name + '模式';
        DOM.missionTimer.classList.toggle('hidden', this.mode.type !== 'special');

        if (SAVE_DATA.isFirstPlay && this.modeId === 'rookie') {
            DOM.tutorialUI.classList.remove('hidden');
            UIHelper.addTimeout(() => { DOM.tutorialUI.classList.add('hidden'); SAVE_DATA.isFirstPlay = false; localStorage.setItem('isFirstPlay', '0'); }, 8000);
        }

        this.lastTime = Date.now();
        DOM.hud.classList.remove('hidden');
    }

    die() {
        this.state.playing = false; UIHelper.unlockAchievement('first_blood');
        var rankMult = HEAT_RANKS[this.state.heatRank].scoreMult;
        var biomeMult = this.state.currentBiome === 'quantum' ? 1.6 : (this.state.currentBiome === 'lava' ? 1.3 : 1.0);
        let totalScore = Math.floor((this.state.time * 100 * 0.4 * biomeMult + this.state.actionScore * 0.6) * rankMult);
        this.lastModeId = this.modeId;

        SAVE_DATA.totalCores += this.state.gold; localStorage.setItem('totalCores', SAVE_DATA.totalCores);

        var isNewHigh = false;
        if (this.mode.type === 'adv' || this.mode.type === 'endless') {
            SAVE_DATA.highScores.push({ time: this.state.time, score: totalScore });
            SAVE_DATA.highScores.sort((a,b)=>b.time-a.time);
            if (SAVE_DATA.highScores.length > 5) isNewHigh = true;
            SAVE_DATA.highScores = SAVE_DATA.highScores.slice(0, 5); localStorage.setItem('highScoresTime', JSON.stringify(SAVE_DATA.highScores));
            if (SAVE_DATA.highScores.length > 0 && SAVE_DATA.highScores[0].time === this.state.time) isNewHigh = true;
        }

        UIHelper.showGlassShatter(); SFX.glassShatter(); SFX.disableLowHealthAudio();
        DOM.hud.classList.add('hidden'); window.showPanel('game-over');

        document.querySelector('#game-over h1').innerText = '机体严重受损';
        document.querySelector('#game-over h1').style.color = 'var(--damage)';
        document.getElementById('final-time').innerText = `存活时间: ${this.state.time.toFixed(1)}s`;
        document.getElementById('final-score').innerText = `综合得分: ${totalScore}`;
        document.getElementById('final-stats').innerText = `战局核心: ${this.state.gold} | 最高连击: ${this.state.comboPeak}`;
        document.getElementById('final-new-highscore').style.display = isNewHigh ? 'block' : 'none';
        document.getElementById('final-cause').innerText = this.state.lastDamageCause || '';
        var talentsList = document.getElementById('final-talents-list');
        talentsList.innerHTML = '';
        var tierColors = ['#888','#4488ff','#9933ff','#ffd700'];
        this.state.talents.forEach(function(t) {
            talentsList.innerHTML += '<span style="color:' + (tierColors[t.tier] || '#fff') + '; margin-right:8px;">[T' + t.tier + '] ' + t.name + '</span>';
        });
        if (this.state.talents.length === 0) talentsList.innerText = '无';
        UIHelper.updateTotalCores(); UIHelper.updateUpgradeUI();
    }

    missionComplete() {
        this.state.playing = false;
        let earnedCores = this.state.gold;
        var rankMult = HEAT_RANKS[this.state.heatRank].scoreMult;
        var biomeMult = this.state.currentBiome === 'quantum' ? 1.6 : (this.state.currentBiome === 'lava' ? 1.3 : 1.0);
        let totalScore = Math.floor((this.state.time * 100 * 0.4 * biomeMult + this.state.actionScore * 0.6) * rankMult);
        if (this.modeId === 'super_core') earnedCores += Math.floor(totalScore / 2);
        SAVE_DATA.totalCores += earnedCores; localStorage.setItem('totalCores', SAVE_DATA.totalCores);
        this.lastModeId = this.modeId;

        UIHelper.showGlassShatter(); SFX.glassShatter(); SFX.disableLowHealthAudio();
        DOM.hud.classList.add('hidden'); window.showPanel('game-over');

        document.querySelector('#game-over h1').innerText = '任务完成';
        document.querySelector('#game-over h1').style.color = 'var(--energy)';
        document.getElementById('final-time').innerText = `耗时: ${this.state.time.toFixed(1)}s`;
        document.getElementById('final-score').innerText = `综合得分: ${totalScore}`;
        document.getElementById('final-stats').innerText = `获得核心: ${earnedCores} | 最高连击: ${this.state.comboPeak}`;
        document.getElementById('final-new-highscore').style.display = 'none';
        document.getElementById('final-cause').innerText = '';
        var talentsList = document.getElementById('final-talents-list');
        talentsList.innerHTML = '';
        var tierColors = ['#888','#4488ff','#9933ff','#ffd700'];
        this.state.talents.forEach(function(t) {
            talentsList.innerHTML += '<span style="color:' + (tierColors[t.tier] || '#fff') + '; margin-right:8px;">[T' + t.tier + '] ' + t.name + '</span>';
        });
        if (this.state.talents.length === 0) talentsList.innerText = '无';
        UIHelper.updateTotalCores(); UIHelper.updateUpgradeUI();
    }

    takeDamage(rawAmount, force = false) {
        const now = Date.now();
        if(!force) {
            if (now < this.state.invincibleUntil || this.state.isRampage || now < this.state.springboardUntil || now - this.state.lastHitTime < this.mode.iframe) return;
            // Dodge Check
            if (Math.random() * 100 < this.state.stats.dodge) {
                UIHelper.showFloatingText('闪避！', this.ship.position, '#00ff88');
                this.state._dodgeCount = (this.state._dodgeCount || 0) + 1;
                if (this.state._dodgeCount >= 10) UIHelper.unlockAchievement('dodge_10');
                return;
            }
        }

        let amount = rawAmount;
        if (!force) {
            let stage = Math.floor(this.state.time / 30); if (!this.mode.endless && stage > 3) stage = 3;
            amount *= Math.pow(1.3, stage); amount *= this.mode.dmgMult;

            if (this.state.activeSkill === 'ironWall') { amount *= 0.2; UIHelper.showFloatingText('格挡！', this.ship.position, '#ffd700'); }
            else if(SAVE_DATA.currentMech === 'heavy' && Math.random() < 0.2) { amount *= 0.5; UIHelper.showFloatingText('格挡！', this.ship.position, '#ffd700'); }

            if(this.state.stats.armor > 0) {
                let minDmg = amount * 0.05;
                amount = Math.max(minDmg, amount - this.state.stats.armor);
            }
        }

        this.state.hp -= amount;
        if (this.state.activeSynergies['不朽壁垒']) { this.state.invincibleUntil = Math.max(this.state.invincibleUntil, now + 1000); UIHelper.showFloatingText('不朽壁垒!', this.ship.position, '#ffd700'); }
        this.state.lastDamageCause = force ? '过载暴走' : '陨石撞击';
        this.state.comboPunishment = Math.max(this.state.comboPunishment, 0.5);
        this.state.combo = Math.floor(this.state.combo * (1 - this.state.comboPunishment));
        this.state.comboGraceUntil = now + 1000;
        DOM.comboVal.innerText = 'x' + this.state.combo;
        this.state.lastHitTime = now; this.cameraShake = 1.0;

        if (this.mode.stun > 0 && !force) {
            this.state.stunUntil = now + this.mode.stun;
            this.shipBody.material.emissive.setHex(0xffffff);
            UIHelper.addTimeout(() => { if(this.state.hp > 0 && !this.state.isRampage && this.state.activeSkill !== 'ironWall') this.shipBody.material.emissive.setHex(0x000000); }, this.mode.stun);
        }

        SFX.takeDamage(); UIHelper.flashDamage(); this.particles.explode(this.ship.position, 0xff0000, 30, 1.0);
        this.state.dynamicDensityMultiplier = Math.max(0.5, this.state.dynamicDensityMultiplier - 0.15);
        if(this.state.hp <= 0) this.die();
    }

    checkWallCollision(wall, oldWallZ = null) {
        const shipZ = this.ship.position.z;
        const wallZ = wall.position.z;
        const wallSpeed = this.currentSpeed;

        if (oldWallZ !== undefined) {
            const zMin = Math.min(oldWallZ, wallZ);
            const zMax = Math.max(oldWallZ, wallZ);
            if (shipZ >= zMin - 2 && shipZ <= zMax + 2) {
                return this.checkWallCollisionAtZ(wall, shipZ);
            }
        }

        const threshold = Math.max(4, wallSpeed * 0.3 + 2.5);
        if (Math.abs(shipZ - wallZ) > threshold) return false;

        return this.checkWallCollisionAtZ(wall, shipZ);
    }

    checkWallCollisionAtZ(wall, shipZ) {
        const dx = this.ship.position.x;
        const dy = this.ship.position.y;
        const shipRadius = Math.sqrt(dx * dx + dy * dy);
        const mechScale = MECH_CONFIGS[SAVE_DATA.currentMech].scale;
        const shipCollisionRadius = 0.5 * mechScale;
        const wallCollisionRadius = wall.userData.radius;
        const effectiveRadius = wallCollisionRadius + shipCollisionRadius;

        if (shipRadius > effectiveRadius) return false;

        let shipAngle = Math.atan2(dy, dx);
        if (shipAngle < 0) shipAngle += Math.PI * 2;

        let rotZ = wall.rotation.z;
        let start = (wall.userData.startAngle + rotZ) % (Math.PI * 2);
        if (start < 0) start += Math.PI * 2;

        let end = (start + wall.userData.closedAngle) % (Math.PI * 2);
        if (end < 0) end += Math.PI * 2;

        let inWallArea = false;
        if (start < end) {
            inWallArea = shipAngle >= start && shipAngle <= end;
        } else {
            inWallArea = shipAngle >= start || shipAngle <= end;
        }
        return inWallArea;
    }

    checkRoguelikeLevelUp() {
        if(this.mode.type === 'special') return;
        let totalScore = Math.floor(this.state.time * 100 * 0.4 + this.state.actionScore * 0.6);

        var thresholds = [0, 15000, 30000, 45000, 70000, 95000, 120000, 160000, 200000, 240000, 280000];
        var threshold = 0;
        if (this.state.nextRoguelikeLevel <= 10) {
            threshold = thresholds[this.state.nextRoguelikeLevel];
        } else {
            threshold = 280000 + (this.state.nextRoguelikeLevel - 10) * 60000;
        }
        if(totalScore >= threshold) {
            this.state.nextRoguelikeLevel++;
            this.state.rerollCount = 0;
            this.showRoguelikeMenu();
        }
    }

    showRoguelikeMenu() {
        this.state.paused = true;
        DOM.overlay.classList.remove('hidden');
        document.getElementById('roguelike-ui').classList.remove('hidden');
        if (window.customCursor) window.customCursor.setVisibility(true);
        this.rollTalentOptions();
    }

    rollTalentOptions() {
        const container = document.getElementById('rl-cards');
        container.innerHTML = '';
        document.getElementById('rl-current-cores').innerText = this.state.gold;

        let cost = 5; if(this.state.rerollCount===1) cost=10; else if(this.state.rerollCount===2) cost=20; else if(this.state.rerollCount>=3) cost = 20 + (this.state.rerollCount-2)*10;
        document.getElementById('btn-reroll').innerText = `重置系统芯片 (-${cost}核心)`;

        let availableTalents = TALENTS_DB.filter(db => {
            let records = this.state.talentRecords[db.id] || [];
            return records.length < 2;
        });

        if(availableTalents.length === 0) availableTalents = TALENTS_DB;

        for(let i=0; i<4; i++) {
            let luck = this.state.stats.luck;
            let t4 = Math.min(15, 3 + luck*0.1);
            let t3 = 12 + luck*0.2;
            let t2 = 25;
            let roll = Math.random() * 100;
            let tier = 1;
            if(roll < t4) tier = 4;
            else if(roll < t4 + t3) tier = 3;
            else if(roll < t4 + t3 + t2) tier = 2;

            let db = availableTalents[Math.floor(Math.random() * availableTalents.length)];
            let val = db.values[tier-1];
            let desc = db.desc[tier-1];

            let div = document.createElement('div');
            div.className = `rl-card cursor-target rl-tier-${tier}`;
            div.innerHTML = `<div class="rl-card-title">${db.name} (T${tier})</div><div class="rl-card-desc">【${db.type}】${db.stat} ${desc}</div>`;
            div.onclick = () => this.selectTalent(db, tier, val, desc);
            container.appendChild(div);
        }
    }

    rerollTalents() {
        let cost = 5; if(this.state.rerollCount===1) cost=10; else if(this.state.rerollCount===2) cost=20; else if(this.state.rerollCount>=3) cost = 20 + (this.state.rerollCount-2)*10;
        if(this.state.gold >= cost) {
            this.state.gold -= cost;
            this.state.rerollCount++;
            this.rollTalentOptions();
        } else {
            UIHelper.logAction('核心不足以重置', '#ff3366');
        }
    }

    selectTalent(db, tier, val, desc) {
        this.state.talents.push({ id: db.id, tier, name: db.name, stat: db.stat, val, valDesc: desc });

        let records = this.state.talentRecords[db.id] || [];
        records.push({tier, val});
        records.sort((a,b) => b.tier - a.tier);
        if(records.length > 2) {
            let dropped = records.pop();
            this.state.stats[db.id] -= dropped.val;
        }
        this.state.talentRecords[db.id] = records;

        this.state.stats[db.id] += val;

        if(this.state.stats.dodge > 60) this.state.stats.dodge = 60;
        if(this.state.stats.cdr > 90) this.state.stats.cdr = 90;

        if(tier === 4) UIHelper.unlockAchievement('tier4_get');
        this.checkSynergies();

        document.getElementById('roguelike-ui').classList.add('hidden');
        DOM.overlay.classList.add('hidden');
        if (window.customCursor) window.customCursor.setVisibility(false);
        this.state.paused = false;
        this.lastTime = Date.now();
    }

    checkSynergies() {
        var talentIds = [];
        this.state.talents.forEach(function(t) { if (t.tier >= 2) talentIds.push(t.stat); });
        for (var i = 0; i < TALENT_SYNERGIES.length; i++) {
            var syn = TALENT_SYNERGIES[i];
            if (this.state.activeSynergies[syn.name]) continue;
            var hasAll = syn.combo.every(function(id) { return talentIds.indexOf(id) !== -1; });
            if (hasAll) {
                this.state.activeSynergies[syn.name] = true;
                UIHelper.showFloatingText('协同激活: ' + syn.name + '!', this.ship.position, '#ffd700');
                SFX.synergyUnlock && SFX.synergyUnlock();
                UIHelper.logAction(syn.name + ': ' + syn.effect, '#ffd700');
                var count = Object.keys(this.state.activeSynergies).length;
                if (count >= 5) UIHelper.unlockAchievement('synergy_5');
                else if (count >= 3) UIHelper.unlockAchievement('synergy_3');
            }
        }
    }

    update() {
        if(!this.state.playing || this.state.paused) return;
        const now = Date.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        let timeScale = 1.0;
        if(this.state.bulletTimeActive) {
            timeScale = CONFIG.BULLET_TIME_SPEED;
            if(now > this.state.bulletTimeUntil) { this.state.bulletTimeActive = false; this.invertPass.material.uniforms.amount.value = 0.0; }
        }
        this.state.time += dt * timeScale;

        if (this.state.comboTimer > 0) {
            this.state.comboTimer -= dt * timeScale;
            if (this.state.comboTimer <= 0) {
                if (this.state.comboGraceUntil > 0 && now < this.state.comboGraceUntil) {
                    this.state.comboTimer = 0.5;
                } else {
                    this.state.comboPunishment = Math.max(0, this.state.comboPunishment - 0.3 * dt * timeScale);
                    if (this.state.comboPunishment <= 0) { this.state.combo = 0; DOM.comboVal.innerText = 'x0'; }
                }
            }
        }
        if (this.state.killStreakTimer > 0) {
            this.state.killStreakTimer -= dt * timeScale;
            if (this.state.killStreakTimer <= 0) this.state.killStreak = 0;
        }

        this.computeHeatRank();
        this.rankMult = HEAT_RANKS[this.state.heatRank].scoreMult;
        this.checkRoguelikeLevelUp();

        this.state.harvestTimer += dt * timeScale;
        if(this.state.harvestTimer >= 30) {
            this.state.harvestTimer = 0;
            let gain = Math.min(100, this.state.stats.harvest);
            if(gain > 0) { this.state.gold += gain; UIHelper.logAction(`收获核心 +${gain}`, '#ffd700'); }
        }

        if(this.state.stats.regen > 0 && this.state.hp > 0 && this.state.hp < this.getMaxHP() * 0.8) {
            var regenMult = (this.state.activeSynergies['不死鸟协议'] && this.state.hp < this.getMaxHP() * 0.3) ? 3 : 1;
            this.state.hp = Math.min(this.getMaxHP() * 0.8, this.state.hp + this.state.stats.regen * regenMult * dt * timeScale);
        }

        let currentSec = Math.floor(this.state.time);
        if(currentSec > this.state.lastSecCheck) {
            this.state.lastSecCheck = currentSec;
            let tc = SAVE_DATA.totalCores;
            if (tc >= 1000) UIHelper.unlockAchievement('cores_1000');

            let tScore = this.state.time * 100 * 0.4 + this.state.actionScore * 0.6;
            if(tScore >= 20000) UIHelper.unlockAchievement('score_20k');
            if(tScore >= 100000) UIHelper.unlockAchievement('score_100k');
            if(this.state.time >= 120) UIHelper.unlockAchievement('time_120');
            if(this.state.time >= 300) UIHelper.unlockAchievement('time_300');
            if(this.state.time >= 600) UIHelper.unlockAchievement('time_600');
            if(tScore >= 500000) UIHelper.unlockAchievement('score_500k');
            if(tScore >= 1000000) UIHelper.unlockAchievement('score_1m');

            if(tScore >= CONFIG.BIOME_QUANTUM_SCORE && this.state.currentBiome !== 'quantum' && this.mode.type !== 'special') {
                this.state.currentBiome = 'quantum'; this.scene.fog = new THREE.FogExp2(0x200830, 0.003);
                UIHelper.logAction('量子领域展开', '#9933ff');
            } else if(tScore >= CONFIG.BIOME_LAVA_SCORE && this.state.currentBiome !== 'lava' && this.state.currentBiome !== 'quantum' && this.mode.type !== 'special') {
                this.state.currentBiome = 'lava'; this.scene.fog = new THREE.FogExp2(0x301008, 0.003);
                UIHelper.logAction('进入熔岩区', '#ff4500');
            }
        }

        if (this.mode.type === 'special' && this.state.time >= this.state.missionDuration) { this.missionComplete(); return; }
        if(this.state.currentBiome === 'quantum') { this.state.tunnelRotation += 0.5 * dt * timeScale; this.tunnelGroup.rotation.z = this.state.tunnelRotation; }

        const baseS = CONFIG.BASE_SPEED * MECH_CONFIGS[SAVE_DATA.currentMech].speed;
        let stage = Math.floor(this.state.time / 30); if (!this.mode.endless && stage > 3) stage = 3;
        let stageTime = this.state.time % 30; let progress = Math.min(stageTime / 15.0, 1.0);

        let calcSpeed = baseS;
        if (this.mode.endless) { calcSpeed += baseS * 0.5 * (stage + progress); }
        else { calcSpeed += baseS * (this.mode.maxSpeedMult - 1.0) * (stage + progress) / 3; }
        this.currentSpeed = calcSpeed * timeScale;

        this.checkBossTrigger();
        this.updateWaves(now, dt);
        this.updatePlayerState(now, dt, timeScale, baseS);
        this.updateMovement(now, dt, timeScale);
        if (!this.state.bossActive) this.updateSpawns(now, dt, timeScale);
        this.updateCollisions(now, dt, timeScale);
        this.updateEntities(now, dt, timeScale);
        this.updateBoss(now, dt);

        if (this.particles) this.particles.update();
        this.updateHUD();
    }

    updatePlayerState(now, dt, timeScale, baseS) {
        if (this.modeId === 'sweeper') this.state.energy = 100;

        if (this.state.activeSkill === 'ironWall') {
            if (now > this.state.skillActiveUntil) { this.state.activeSkill = null; if (!this.state.isRampage && now > this.state.stunUntil) this.shipBody.material.emissive.setHex(0x000000); }
            else { this.currentSpeed *= 0.5; }
        }
        if (this.state.activeSkill === 'spread' && now > this.state.skillActiveUntil) this.state.activeSkill = null;

        let inCooldown = now < this.state.overloadCooldownUntil;
        let canBoost = this.state.energy > 2 && !inCooldown && !this.state.isRampage && now > this.state.stunUntil;
        let isSpringboard = now < this.state.springboardUntil;

        if (isSpringboard) {
            this.currentSpeed *= 5.0; this.state.invincibleUntil = Math.max(this.state.invincibleUntil, now + 100);
            this.cameraShake = Math.max(this.cameraShake, 0.1); this.camera.fov += (100 - this.camera.fov) * 0.1;
            this.particles.spawnSpeedTrail(this.ship.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.5, (Math.random()-0.5)*1.5, 0)), this.currentSpeed);
        } else if(this.state.isRampage) {
            if(now > this.state.rampageUntil) {
                this.state.isRampage = false; this.state.overloadCooldownUntil = now + 5000;
                this.state.energy = 0; this.state.overload = 0;
                if(now > this.state.stunUntil && this.state.activeSkill !== 'ironWall') this.shipBody.material.emissive.setHex(0x000000);
            } else {
                this.currentSpeed *= 3.0; this.cameraShake = Math.max(this.cameraShake, 0.1);
                this.particles.spawnSpeedTrail(this.ship.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.5, (Math.random()-0.5)*1.5, 0)), this.currentSpeed);
            }
        } else if(this.state.isBoosting && canBoost) {
            this.currentSpeed *= 2.0;
            if(this.modeId !== 'sweeper') this.state.energy -= Math.max(0.1, 0.8 - SAVE_DATA.upgrades.engine * 0.1) * dt * 60 * timeScale;

            let olHeat = (1 - this.state.stats.overload / 100);
            this.state.overload += 1.5 * olHeat * dt * 60 * timeScale;
            this.state.overloadDecayTimer = now + 2000;

            this.engineFlame.scale.set(1.5, 2, 1.5); this.cameraShake = Math.max(this.cameraShake, 0.05); this.camera.fov += (90 - this.camera.fov) * 0.1;

            let fallBackDir = this.ship.position.clone(); if(fallBackDir.lengthSq() < 0.001) fallBackDir.set(0, 0, -1); else fallBackDir.normalize();
            this.wingPositions.forEach(relPos => {
                const worldPos = new THREE.Vector3().copy(relPos).applyMatrix4(this.ship.matrixWorld);
                this.particles.spawnTrail(worldPos, MECH_CONFIGS[SAVE_DATA.currentMech].color, fallBackDir);
            });
            if (this.currentSpeed > baseS * 2) this.particles.spawnSpeedTrail(this.ship.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.5, (Math.random()-0.5)*1.5, 0)), this.currentSpeed);

            if (this.state.overload > 200) {
                var ol = document.getElementById('damage-overlay');
                if (ol) { ol.style.opacity = String(0.15 + 0.1 * Math.sin(now * 0.01)); ol.style.background = 'rgba(255,0,0,' + (0.1 + 0.05 * Math.sin(now * 0.01)) + ')'; }
            }
            if (this.state.overload > 280) { this.cameraShake = Math.max(this.cameraShake, 0.2); }
            if(this.state.overload >= 300) {
                this.state.isRampage = true; let rampageDur = 3000; if(SAVE_DATA.currentMech === 'default') rampageDur += 1000;
                this.state.rampageUntil = now + rampageDur; this.state.overload = 300;
                this.shipBody.material.emissive.setHex(0xff4500); SFX.rampage();

                UIHelper.showFloatingText('过载反噬！', this.ship.position, '#ff0000');
                let dmg = 20 * Math.pow(1.3, Math.floor(this.state.time/30)); if (SAVE_DATA.currentMech === 'default') dmg *= 0.8;
                this.takeDamage(dmg, true);
            }
        } else {
            if(inCooldown) { this.currentSpeed *= 0.5; this.state.energy = 0; }
            else if(this.modeId !== 'sweeper') this.state.energy = Math.min(this.state.stats.maxEn, this.state.energy + 15.0 * dt * timeScale);
            if(now > this.state.overloadDecayTimer && this.state.overload > 0) this.state.overload = Math.max(0, this.state.overload - 100.0 * dt * timeScale);
            this.engineFlame.scale.set(1, 1, 1); this.camera.fov += (75 - this.camera.fov) * 0.1;
        }

        DOM.doubleScoreHint.style.opacity = (now < this.state.doubleScoreUntil) ? '1' : '0';

        const maxHP = this.getMaxHP();
        if(this.state.hp / maxHP < 0.3 && !this.state.isRampage && now > this.state.stunUntil && this.state.activeSkill !== 'ironWall') {
            SFX.enableLowHealthAudio(); this.shipBody.material.emissive.setHex(0x550000);
            if(Math.random() < 0.1) this.particles.spawnSmoke(this.ship.position.clone());
        } else if (!this.state.isRampage && now > this.state.stunUntil && this.state.activeSkill !== 'ironWall') {
            SFX.disableLowHealthAudio(); this.shipBody.material.emissive.setHex(0x000000);
        }
    }

    updateMovement(now, dt, timeScale) {
        this.camera.updateProjectionMatrix();
        let rankMult = HEAT_RANKS[this.state.heatRank].scoreMult;
        let doubleMult = (now < this.state.doubleScoreUntil) ? 2 : 1; doubleMult *= this.mode.scoreMult;
        this.state.actionScore += this.currentSpeed * 2.0 * dt * timeScale * doubleMult * rankMult;

        let inStun = now < this.state.stunUntil;
        let isSpringboard = now < this.state.springboardUntil;
        if (!inStun && !isSpringboard) {
            let targetX = this.state.mouseX * CONFIG.TUNNEL_RADIUS, targetY = this.state.mouseY * CONFIG.TUNNEL_RADIUS;
            let r = Math.sqrt(targetX*targetX + targetY*targetY);
            let maxR = Math.max(0, CONFIG.TUNNEL_RADIUS - 1.5);
            if (r > maxR) { targetX = (targetX / r) * maxR; targetY = (targetY / r) * maxR; }

            this.ship.position.x += (targetX - this.ship.position.x) * 10.0 * dt * timeScale;
            this.ship.position.y += (targetY - this.ship.position.y) * 10.0 * dt * timeScale;
            this.ship.rotation.z = -(targetX - this.ship.position.x) * 0.15;
            this.ship.rotation.x = (targetY - this.ship.position.y) * 0.1;

            this.camera.rotation.z += (-this.state.mouseX * 0.15 - this.camera.rotation.z) * 0.1;
        } else if(inStun) { this.state.isBoosting = false; }

        if(this.cameraShake > 0) {
            this.camera.position.x = this.cameraBasePos.x + (Math.random()-0.5)*this.cameraShake;
            this.camera.position.y = this.cameraBasePos.y + (Math.random()-0.5)*this.cameraShake;
            this.cameraShake *= 0.9; if(this.cameraShake < 0.01) this.cameraShake = 0;
        } else { this.camera.position.copy(this.cameraBasePos); }
    }

    updateSpawns(now, dt, timeScale) {
        if (SAVE_DATA.isFirstPlay && this.state.time < 10 && this.modeId === 'rookie') return;

        if (this.state.time >= this.state.nextSafeTunnelTime && this.mode.type !== 'special') {
            this.state.nextSafeTunnelTime = this.state.time + 40 + Math.random() * 10;
            if (Math.random() < 0.5) { this.state.safeTunnelUntil = this.state.time + 8; UIHelper.logAction('进入安全区', '#00ff88'); }
        }
        let isSafeZone = this.state.time < this.state.safeTunnelUntil;
        this.state.safeAngleTimer -= dt * timeScale;
        if(this.state.safeAngleTimer <= 0) { this.state.safeWallAngle = Math.random() * Math.PI * 2; this.state.safeAngleTimer = 1.0; }

        let isVacuum = (this.state.time % 15) < 2;
        let density = CONFIG.OBSTACLE_DENSITY * this.state.dynamicDensityMultiplier * this.mode.density;

        if (this.modeId === 'sweeper') {
            if (Math.random() < 10.0 * density * dt * timeScale) this.spawnRock(true);
        } else if (this.modeId === 'super_core') {
            if (Math.random() < 15.0 * dt * timeScale && this.objects.items.length < 80) this.spawnItem('gold');
            if (Math.random() < 2.5 * dt * timeScale) this.spawnGoldPattern();
        } else {
            var wc = this.state.waveComposition;
            var rMult = wc ? wc.rocksMult : 1;
            var wMult = wc ? wc.wallsMult : 1;
            var mMult = wc ? wc.minesMult : 1;
            var dMult = wc ? wc.dronesMult : 1;
            if (!isVacuum && !isSafeZone) {
                if(Math.random() < 1.2 * density * this.currentSpeed * dt * timeScale * rMult) this.spawnRock();
                if(Math.random() < 0.22 * density * this.currentSpeed * dt * timeScale * wMult) this.spawnWall();
                if(Math.random() < 0.05 * dt * timeScale) this.spawnSpringboard();
                if(this.state.time > 30 && Math.random() < 0.08 * density * this.currentSpeed * dt * timeScale * mMult) this.spawnMineCluster();
                if(this.state.time > 60 && Math.random() < 0.12 * density * this.currentSpeed * dt * timeScale * mMult * 0.5) this.spawnLaserWall();
                if(this.state.time > 90 && Math.random() < 0.03 * this.currentSpeed * dt * timeScale * dMult) this.spawnDrone();
            }
        }

        if (this.mode.type !== 'special') {
            if(isSafeZone) {
                if(Math.random() < 2.5 * dt * timeScale) this.spawnGoldPattern();
            } else {
                if(Math.random() < 0.25 * dt * timeScale) this.spawnItem('gold');
                if(Math.random() < 0.05 * dt * timeScale) this.spawnItem('power');
                if(Math.random() < 0.025 * dt * timeScale) this.spawnItem('double_score');
                if(Math.random() < 0.025 * dt * timeScale) this.spawnCoreString();
            }
        }
        if(Math.random() < 1.0 * dt * timeScale) this.spawnMeteor();
    }

    updateCollisions(now, dt, timeScale) {
        let doubleMult = (now < this.state.doubleScoreUntil) ? 2 : 1; doubleMult *= this.mode.scoreMult;

        for(let i=this.objects.bullets.length-1; i>=0; i--) {
            let b = this.objects.bullets[i]; b.position.z -= 60 * dt * timeScale; b.position.x += b.userData.vx * 60 * dt * timeScale;
            let bHit = false;
            for(let j=this.objects.rocks.length-1; j>=0; j--) {
                let r = this.objects.rocks[j];
                if(b.position.distanceTo(r.position) < r.userData.radius + 1) {
                    r.userData.hp -= b.userData.damage;
                    this.particles.explode(r.position, 0xffaa00, 3);
                    SFX.hitObj();
                    b.userData.pierce--; if (b.userData.pierce < 0) { bHit = true; break; }
                }
            }
            if (!bHit) {
                for (let j = this.objects.drones.length-1; j >= 0; j--) {
                    let d = this.objects.drones[j];
                    if (b.position.distanceTo(d.position) < 1.5) {
                        d.userData.hp -= b.userData.damage;
                        this.particles.explode(d.position, 0xff4400, 5); SFX.hitObj();
                        if (d.userData.hp <= 0) {
                            this.state.actionScore += 200 * doubleMult * this.rankMult;
                            this.particles.explode(d.position, 0xff6600, 15, 1.5);
                            this.releasePooled('drones', d); this.objects.drones.splice(j, 1);
                        }
                        b.userData.pierce--; if (b.userData.pierce < 0) { bHit = true; break; }
                    }
                }
            }
            if (!bHit && this.state.bossActive && this.bossGroup && this.bossGroup.visible) {
                if (b.position.distanceTo(this.bossGroup.position) < this.state.bossDef.scale + 1) {
                    this.state.bossHp -= b.userData.damage;
                    this.particles.explode(b.position, this.state.bossDef.color, 5);
                    if (this.state.bossHp <= 0) { this.defeatBoss(); }
                    b.userData.pierce--; if (b.userData.pierce < 0) bHit = true;
                }
            }
            if (!bHit && b.userData.isBossBullet && b.position.distanceTo(this.ship.position) < 2) {
                this.takeDamage(b.userData.damage); this.state.lastDamageCause = 'BOSS攻击'; bHit = true;
            }
            if (bHit || b.position.z < -400) { this.releasePooled('bullets', b); this.objects.bullets.splice(i, 1); }
            if (b.userData.isBossBullet && b.position.z > 10) { this.releasePooled('bullets', b); this.objects.bullets.splice(i, 1); }
        }

        for(let i=this.objects.walls.length-1; i>=0; i--) {
            let w = this.objects.walls[i];
            const oldZ = w.position.z;
            w.position.z += this.currentSpeed;
            w.rotation.z += 0.5 * dt * timeScale;

            if(this.checkWallCollision(w, oldZ)) {
                this.takeDamage(20);
                this.particles.explode(this.ship.position, 0xff3366, 12);
            }

            if(w.position.z > -5 && w.position.z < 5 && !w.userData.passed) {
                w.userData.passed = true;
                this.incrementCombo();
            }
            if(w.position.z > 20) {
                this.safeRemove(w);
                this.objects.walls.splice(i,1);
            }
        }

        for(let i=this.objects.rocks.length-1; i>=0; i--) {
            let r = this.objects.rocks[i];

            if(r.userData.hp <= 0) {
                SFX.rockExplode(); this.particles.explode(r.position, r.userData.type.color, this.modeId === 'sweeper' ? 5 : 12); this.incrementCombo();
                let pts = Math.floor(150 * r.userData.type.scoreMult * (1 + this.state.combo * 0.1) * doubleMult * this.rankMult);
                UIHelper.logAction(`+${pts} 击碎${r.userData.type.name}陨石`, '#ffffff');
                this.state.actionScore += pts;
                if(r.userData.type.isCore) {
                    this.state.gold += 20; UIHelper.logAction('+20 核心！', '#ff4500'); UIHelper.unlockAchievement('core_meteor');
                }
                this.releasePooled('rocks', r); this.objects.rocks.splice(i, 1);
                continue;
            }

            let rockSpeed = this.currentSpeed; if(r.userData.isSweeper) rockSpeed *= 0.2;

            let oldZ = r.position.z;
            r.position.z += rockSpeed; r.rotation.x += 0.5 * dt * timeScale; r.rotation.y += 1.0 * dt * timeScale;
            if (r.userData.vx) { r.position.x += r.userData.vx * dt; r.position.y += r.userData.vy * dt; }

            let hitRadius = r.userData.radius + 0.8;
            let shipPos = this.ship.position;

            let zPassed = (oldZ <= shipPos.z + 2 && r.position.z >= shipPos.z - 2);
            let minDist = Infinity;

            if (zPassed) {
                let points = [ shipPos, new THREE.Vector3(shipPos.x - 1.5, shipPos.y, shipPos.z), new THREE.Vector3(shipPos.x + 1.5, shipPos.y, shipPos.z) ];
                let isHit = false;
                for(let p of points) {
                    let dx = r.position.x - p.x; let dy = r.position.y - p.y;
                    let dist2D = Math.sqrt(dx*dx + dy*dy);
                    if (dist2D < hitRadius) isHit = true;
                    if (dist2D < minDist) minDist = dist2D;
                }

                if (isHit) {
                    this.takeDamage(15); this.particles.explode(r.position, 0x888888, 10);
                    this.releasePooled('rocks', r); this.objects.rocks.splice(i, 1);
                    continue;
                }
            }

            minDist = r.position.distanceTo(shipPos);
            if (minDist < hitRadius + CONFIG.GRAZE_DISTANCE + this.state.stats.graze && !r.userData.grazed && zPassed) {
                r.userData.grazed = true; UIHelper.unlockAchievement('first_graze');
                this.state._grazeCount = (this.state._grazeCount || 0) + 1;
                if (this.state._grazeCount >= 50) UIHelper.unlockAchievement('graze_50');
                if(minDist < hitRadius + 0.7 && this.modeId !== 'sweeper') {
                    this.state.energy = this.state.stats.maxEn; this.incrementCombo(3); UIHelper.showGrazeHint(true); SFX.crazyGraze();
                    if (this.state.activeSynergies['幻影舞步']) { this.state.stats.dodge = Math.min(60, this.state.stats.dodge * 2); UIHelper.addTimeout(() => { this.state.stats.dodge = Math.min(60, this.state.stats.dodge / 2); }, 3000); }
                    let pts = 300 * (1 + this.state.combo * 0.1) * doubleMult * this.rankMult; this.state.actionScore += pts; UIHelper.logAction(`+${Math.floor(pts)} 极限擦弹`, '#ff3366');
                    UIHelper.unlockAchievement('crazy_graze');
                    this.state.dynamicDensityMultiplier = Math.max(0.5, this.state.dynamicDensityMultiplier - 0.15); UIHelper.flashDamage();
                } else {
                    let eGain = 10; if(SAVE_DATA.currentMech === 'assassin') eGain *= 2;
                    this.state.energy = Math.min(this.state.stats.maxEn, this.state.energy + eGain);
                    this.incrementCombo(1); UIHelper.showGrazeHint(false); SFX.graze();
                    let pts = 100 * (1 + this.state.combo * 0.1) * doubleMult * this.rankMult; this.state.actionScore += pts; UIHelper.logAction(`+${Math.floor(pts)} 擦弹`, '#00ff88');
                }
            } else if (r.position.z > 20) {
                this.releasePooled('rocks', r); this.objects.rocks.splice(i, 1);
            }
        }

        for (let i = this.objects.drones.length-1; i >= 0; i--) {
            let d = this.objects.drones[i];
            if (!d.userData.passed && d.position.distanceTo(this.ship.position) < 1.5) {
                this.takeDamage(12); this.state.lastDamageCause = '无人机撞击';
                this.particles.explode(d.position, 0xff6600, 15, 1.5);
                this.releasePooled('drones', d); this.objects.drones.splice(i, 1);
            }
        }

        for (let i = this.objects.laserWalls.length-1; i >= 0; i--) {
            let lw = this.objects.laserWalls[i];
            var lwDist = lw.position.distanceTo(this.ship.position);
            var shipAngle = Math.atan2(this.ship.position.y - lw.position.y, this.ship.position.x - lw.position.x);
            var angleDiff = Math.abs(((shipAngle - lw.userData.angle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
            var beamWidth = 0.15;
            if (angleDiff < beamWidth && lwDist < 12 && Math.abs(lw.position.z - this.ship.position.z) < 2) {
                this.takeDamage(10); this.state.lastDamageCause = '激光切割';
                this.state.stunUntil = Math.max(this.state.stunUntil, now + 50);
                this.particles.explode(this.ship.position, 0xff6600, 4);
            }
        }
    }

    updateEntities(now, dt, timeScale) {
        let t = now * 0.001;
        this.wireMat.opacity = 0.15 + 0.05 * Math.sin(t * 5);
        if (this.state.isRampage) {
            this.wireMat.color.setHex(0xff0000);
            this.wireMat.opacity = 0.3 + 0.2 * Math.sin(t * 10);
        } else {
            if(this.state.currentBiome === 'quantum') this.wireMat.color.setHex(0x9933ff);
            else if(this.state.currentBiome === 'lava') this.wireMat.color.setHex(0xff4500);
            else this.wireMat.color.setHex(0x003366);
        }

        this.segments.forEach(s => { s.position.z += this.currentSpeed; if(s.position.z > 200) s.position.z -= 800; });
        this.rings.forEach(r => { r.position.z += this.currentSpeed; if(r.position.z > 50) r.position.z -= 300; });
        let doubleMult = (now < this.state.doubleScoreUntil) ? 2 : 1; doubleMult *= this.mode.scoreMult;
        let isSafeZone = this.state.time < this.state.safeTunnelUntil;
        const maxHP = this.getMaxHP();

        for(let i=this.objects.meteors.length-1; i>=0; i--) {
            let m = this.objects.meteors[i]; m.position.z += m.userData.speed * dt * timeScale;
            if(m.position.z > 100) { this.releasePooled('meteors', m); this.objects.meteors.splice(i, 1); continue; }
            var mDist = m.position.distanceTo(this.ship.position);
            if (mDist < 5 + 0.8 && m.position.z < this.ship.position.z + 2 && m.position.z > this.ship.position.z - 2) {
                this.takeDamage(5); this.cameraShake = Math.max(this.cameraShake, 0.3);
                this.particles.explode(m.position, 0x8844ff, 6);
            }
        }

        for(let i=this.objects.mines.length-1; i>=0; i--) {
            let mine = this.objects.mines[i];
            mine.position.z += this.currentSpeed;
            var now = Date.now();
            if (now >= mine.userData.armedAt) mine.userData.armed = true;
            if (mine.userData.isCenter && mine.userData.armed) {
                var dist = mine.position.distanceTo(this.ship.position);
                if (dist < 5) {
                    this.takeDamage(10); this.particles.explode(mine.position, 0xff2222, 20, 2.0); SFX.mineExplosion && SFX.mineExplosion();
                    for (var j = this.objects.mines.length-1; j >= 0; j--) {
                        var cm = this.objects.mines[j];
                        if (cm.userData.isChild && cm.userData.parent === mine) {
                            this.particles.explode(cm.position, 0xff4444, 6);
                            this.releasePooled('mines', cm); this.objects.mines.splice(j, 1);
                        }
                    }
                    this.releasePooled('mines', mine); this.objects.mines.splice(i, 1);
                }
            }
            if (mine.position.z > 20) { this.releasePooled('mines', mine); this.objects.mines.splice(i, 1); }
        }

        for(let i=this.objects.drones.length-1; i>=0; i--) {
            let drone = this.objects.drones[i];
            var dx = this.ship.position.x - drone.position.x;
            var dy = this.ship.position.y - drone.position.y;
            drone.position.x += dx * drone.userData.homingStrength;
            drone.position.y += dy * drone.userData.homingStrength;
            drone.position.z += this.currentSpeed * 0.7;
            drone.rotation.x += 2 * dt * timeScale; drone.rotation.y += 3 * dt * timeScale;
            if (drone.position.z > this.ship.position.z + 3) drone.userData.passed = true;
            if (drone.position.z > 20) { this.releasePooled('drones', drone); this.objects.drones.splice(i, 1); }
        }

        for(let i=this.objects.laserWalls.length-1; i>=0; i--) {
            let lw = this.objects.laserWalls[i];
            lw.position.z += this.currentSpeed;
            lw.userData.angle += lw.userData.rotSpeed * dt * timeScale;
            lw.position.x = Math.cos(lw.userData.angle) * lw.userData.dist;
            lw.position.y = Math.sin(lw.userData.angle) * lw.userData.dist;
            lw.rotation.z = lw.userData.angle;
            if (Date.now() - lw.userData.spawnedAt > lw.userData.lifetime || lw.position.z > 20) {
                this.releasePooled('laserWalls', lw); this.objects.laserWalls.splice(i, 1);
            }
        }

        for(let i=this.objects.items.length-1; i>=0; i--) {
            let item = this.objects.items[i];
            let dist = item.position.distanceTo(this.ship.position);

            if (item.userData.isPad) {
                item.position.z += this.currentSpeed;
                if (dist < 3) { this.state.springboardUntil = now + 3000; SFX.getPower(); UIHelper.showFloatingText('加速！', item.position, '#ff0000'); this.safeRemove(item); this.objects.items.splice(i, 1); }
                else if (item.position.z > 20) { this.safeRemove(item); this.objects.items.splice(i, 1); }
                continue;
            }

            let magnetRadius = this.state.hasMagnet ? 25 : (2 + this.state.stats.magnet);
            if (this.modeId === 'super_core') magnetRadius = 2.5 + this.state.stats.magnet;
            else if (isSafeZone && item.userData.type === 'gold' && this.state.hasMagnet) magnetRadius = 25;
            else if (isSafeZone && item.userData.type === 'gold') magnetRadius = 2 + this.state.stats.magnet;

            if (dist < magnetRadius) item.position.lerp(this.ship.position, 5.0 * dt * timeScale);
            else item.position.z += this.currentSpeed;
            item.rotation.x += 2.5 * dt * timeScale; item.rotation.y += 2.5 * dt * timeScale;

            if (dist < 2) {
                if(item.userData.type === 'gold') {
                    this.state.gold++;
                    let pts = 800 * (1 + this.state.combo * 0.1) * doubleMult * this.rankMult; this.state.actionScore += pts;
                    if(!this.state.hasMagnet) this.state.hp = Math.min(maxHP, this.state.hp + maxHP/100);
                    SFX.getGold(); UIHelper.logAction(`+${Math.floor(pts)} 收集核心`, '#ffd700');
                    this.particles.explode(item.position, 0xffd700, 8);
                } else if (item.userData.type === 'power') {
                    if(!this.state.hasMagnet) { this.state.invincibleUntil = now + CONFIG.INVINCIBLE_DURATION; UIHelper.logAction('护盾启动', '#ff44ff'); }
                    else { UIHelper.logAction('磁吸超载', '#555'); }
                    SFX.getPower(); this.particles.explode(item.position, 0xff44ff, 15);
                } else if (item.userData.type === 'double_score') {
                    this.state.doubleScoreUntil = now + 10000; SFX.getDouble(); this.particles.explode(item.position, 0x9933ff, 20); UIHelper.logAction('双倍积分！', '#9933ff');
                } else if (item.userData.type === 'energy') {
                    this.state.energy = Math.min(this.state.stats.maxEn, this.state.energy + 20); SFX.getPower(); this.particles.explode(item.position, 0x00ff88, 10); UIHelper.logAction('+20 能量', '#00ff88');
                }
                this.releasePooled('items', item); this.objects.items.splice(i, 1);
            } else if (item.position.z > 20) {
                this.releasePooled('items', item); this.objects.items.splice(i, 1);
            }
        }
    }

    updateHUD() {
        const maxHP = this.getMaxHP();
        var rank = HEAT_RANKS[this.state.heatRank];
        var rankEl = document.getElementById('heat-rank');
        if (rankEl) {
            rankEl.innerText = rank.rank;
            rankEl.style.color = rank.color;
            rankEl.style.textShadow = '0 0 15px ' + rank.color;
        }
        DOM.hpVal.innerText = Math.max(0, Math.floor(this.state.hp));
        DOM.shieldFill.style.width = `${Math.max(0, (this.state.hp/maxHP)*100)}%`;
        DOM.energyVal.innerText = Math.floor(this.state.energy);
        DOM.energyFill.style.width = `${Math.min(100, (this.state.energy/this.state.stats.maxEn)*100)}%`;
        DOM.overloadVal.innerText = `${Math.floor((this.state.overload/300)*100)}%`;
        DOM.overloadFill.style.width = `${(this.state.overload/300)*100}%`;

        let totalScore = Math.floor(this.state.time * 100 * 0.4 + this.state.actionScore * 0.6);
        DOM.scoreVal.innerText = totalScore;
        DOM.goldVal.innerText = this.state.gold;

        let comboPercent = this.state.comboPeak > 0 ? (this.state.combo / this.state.comboPeak) * 100 : 0;
        DOM.comboFill.style.width = comboPercent + '%';
        if (this.state.combo >= 100) { DOM.comboFill.style.background = '#ff4444'; DOM.comboFill.style.boxShadow = '0 0 15px #ff4444'; }
        else if (this.state.combo >= 50) { DOM.comboFill.style.background = '#ff8800'; DOM.comboFill.style.boxShadow = '0 0 10px #ff8800'; }
        else { DOM.comboFill.style.background = 'var(--gold)'; DOM.comboFill.style.boxShadow = '0 0 10px var(--gold)'; }

        DOM.speedLines.style.opacity = (this.state.isBoosting || this.state.isRampage) ? '1' : '0';

        const invFill = DOM.invincibleFill, invVal = DOM.invincibleVal;
        const now = Date.now();
        let invLeft = Math.max(0, (this.state.invincibleUntil - now) / 1000);
        let rampageLeft = Math.max(0, (this.state.rampageUntil - now) / 1000);
        let cdLeft = Math.max(0, (this.state.overloadCooldownUntil - now) / 1000);
        let springboardLeft = Math.max(0, (this.state.springboardUntil - now) / 1000);

        if (springboardLeft > 0) {
            invFill.style.width = '100%'; invVal.innerText = `加速！ ${springboardLeft.toFixed(1)}s`;
            invVal.style.color = '#ff0000'; invFill.style.background = '#ff0000';
        } else if(rampageLeft > 0) {
            invFill.style.width = `${(rampageLeft / 3.0) * 100}%`; invVal.innerText = `暴走！ ${rampageLeft.toFixed(1)}s`;
            invVal.style.color = 'var(--overload)'; invFill.style.background = 'var(--overload)';
        } else if(cdLeft > 0) {
            invFill.style.width = `${(cdLeft / 5.0) * 100}%`; invVal.innerText = `惩罚！ ${cdLeft.toFixed(1)}s`;
            invVal.style.color = '#888'; invFill.style.background = '#888';
        } else if(invLeft > 0) {
            invFill.style.width = `${(invLeft / (CONFIG.INVINCIBLE_DURATION/1000)) * 100}%`; invVal.innerText = `护盾 ${invLeft.toFixed(1)}s`;
            invVal.style.color = 'var(--invincible)'; invFill.style.background = 'var(--invincible)';
        } else {
            invFill.style.width = '0%'; invVal.innerText = '就绪'; invVal.style.color = 'var(--invincible)'; invFill.style.background = 'var(--invincible)';
        }

        let skillLeft = Math.max(0, (this.state.skillCooldownUntil - now) / 1000);
        let qFill = DOM.qSkillFill;
        let qPercent = Math.min(100, (this.state.energy/this.state.stats.maxEn)*100) / 100;
        qFill.setAttribute('y', 60 - 60 * qPercent);

        let eFill = DOM.eSkillFill;
        let eUi = DOM.eSkillUI;
        let eLabel = DOM.eSkillText;
        if (skillLeft > 0) {
            let maxCd = SAVE_DATA.currentMech === 'assassin' ? 12 : 20;
            maxCd *= (1 - this.state.stats.cdr/100);
            eFill.style.height = `${(1 - skillLeft/maxCd) * 100}%`;
            eFill.style.background = '#888'; eUi.style.borderColor = '#888'; eLabel.style.color = '#888';
        } else {
            eFill.style.height = `100%`; eFill.style.background = 'var(--neon)'; eUi.style.borderColor = 'var(--neon)'; eLabel.style.color = 'var(--neon)';
        }

        if (this.mode.type === 'special') {
            let timeLeft = Math.max(0, this.state.missionDuration - this.state.time);
            DOM.missionTimer.innerText = `撤离倒计时: ${timeLeft.toFixed(1)}s`;
        }
    }

    animate() {
        if(!this.state.playing && !this.state.paused) return;
        this.animationId = requestAnimationFrame(this.animate);
        this.update();
        this.composer.render();
    }
}
