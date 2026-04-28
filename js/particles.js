// ======================= 粒子系统 =======================
class ParticleSystem {
    constructor(scene) {
        this.scene = scene; this.particles = []; this.pool = [];
        this.geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        this.trailGeo = new THREE.PlaneGeometry(0.5, 1.5);
        this.smokeGeo = new THREE.SphereGeometry(0.3, 8, 8);
        this.particleMats = {};
        this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
    }
    getMaterial(color) {
        if (!this.particleMats[color]) {
            this.particleMats[color] = new THREE.MeshBasicMaterial({ color: color, transparent: true, blending: THREE.AdditiveBlending });
        }
        return this.particleMats[color];
    }
    getPooledParticle(geo, mat) {
        for(let i=0; i<this.pool.length; i++) {
            if(!this.pool[i].visible) {
                let p = this.pool[i]; p.visible = true; p.geometry = geo; p.material = mat; return p;
            }
        }
        let p = new THREE.Mesh(geo, mat); this.scene.add(p); this.pool.push(p);
        return p;
    }
    explode(position, color, count = 15, speed = 0.5) {
        if (this.isMobile) count = Math.ceil(count * 0.5);
        const mat = this.getMaterial(color);
        for(let i=0; i<count; i++) {
            const p = this.getPooledParticle(this.geo, mat); p.position.copy(position);
            const theta = Math.random() * Math.PI * 2, phi = Math.acos((Math.random() * 2) - 1), r = Math.random() * speed;
            p.userData = {
                velocity: new THREE.Vector3(r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta), r*Math.cos(phi)),
                life: 1.0, decay: 0.02 + Math.random() * 0.03
            };
            this.particles.push(p);
        }
    }
    spawnTrail(position, color, direction) {
        const mat = this.getMaterial(color);
        const p = this.getPooledParticle(this.trailGeo, mat); p.position.copy(position); p.rotation.z = Math.random() * Math.PI * 0.1;
        p.userData = {
            velocity: direction.clone().multiplyScalar(0.1).add(new THREE.Vector3((Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05, -0.1)),
            life: 0.8, decay: 0.03
        };
        this.particles.push(p);
    }
    spawnSmoke(position) {
        const mat = this.getMaterial(0xff3366);
        const p = this.getPooledParticle(this.smokeGeo, mat); p.position.copy(position); p.scale.setScalar(Math.random() * 0.5 + 0.5);
        p.userData = { velocity: new THREE.Vector3((Math.random()-0.5)*0.1, Math.random()*0.1, (Math.random()-0.5)*0.1), life: 1.0, decay: 0.04 };
        this.particles.push(p);
    }
    spawnSpeedTrail(position, speed) {
        const mat = this.getMaterial(0x88ccff);
        const p = this.getPooledParticle(this.smokeGeo, mat); p.position.copy(position); p.scale.set(0.3, 0.3, speed * 2);
        p.userData = { velocity: new THREE.Vector3(0,0, speed * 0.5), life: 0.6, decay: 0.06 };
        this.particles.push(p);
    }
    update() {
        for(let i=this.particles.length-1; i>=0; i--) {
            let p = this.particles[i]; p.position.add(p.userData.velocity); p.scale.setScalar(p.userData.life);
            p.userData.life -= p.userData.decay;
            if(p.userData.life <= 0) { p.visible = false; this.particles.splice(i, 1); }
        }
    }
    dispose() {
        this.particles.forEach(p => p.visible = false);
        this.geo.dispose();
        this.trailGeo.dispose();
        this.smokeGeo.dispose();
        Object.values(this.particleMats).forEach(mat => mat.dispose());
        this.pool.forEach(p => { if(p.parent) p.parent.remove(p); });
        this.particles = [];
        this.pool = [];
        this.particleMats = {};
    }
}
