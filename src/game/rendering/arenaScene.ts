/**
 * 3D Procedural Fighting Arena & Fighter Mesh Renderer
 * Implements strict Three.js directives:
 * - Software-WebGL detection
 * - RoomEnvironment reflection map
 * - ACES Filmic tone mapping
 * - 3-12 part procedural character models (THREE.Group)
 * - Zero GC in animation loop (pre-allocated math objects)
 * - Pooled hit sparks particle ring buffer
 * - Dynamic camera shake and tracking
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FighterState, HitEvent } from '../../types/combat';

// Detect software WebGL for headless Playwright / CPU rendering safety
export const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return true;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

// Reusable math objects (Zero-GC discipline)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

interface FighterMeshRig {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  visor: THREE.Mesh;
  leftArm: THREE.Group;
  leftForearm: THREE.Group;
  leftFist: THREE.Mesh;
  rightArm: THREE.Group;
  rightForearm: THREE.Group;
  rightFist: THREE.Mesh;
  leftLeg: THREE.Group;
  leftCalf: THREE.Group;
  rightLeg: THREE.Group;
  rightCalf: THREE.Group;
  shadowDisc: THREE.Mesh;
  hitFlashTimer: number;
}

export class ArenaRenderer {
  private container: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private pmremGenerator: THREE.PMREMGenerator;

  private playerRig!: FighterMeshRig;
  private opponentRig!: FighterMeshRig;

  // Particle pool for hits
  private particleCount = 60;
  private particleMesh!: THREE.InstancedMesh;
  private particleData: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; color: THREE.Color }[] = [];
  private dummyMatrix = new THREE.Matrix4();

  // Camera trauma shake
  private cameraTrauma = 0;
  private baseCamPos = new THREE.Vector3(0, 2.2, 7.2);

  private frameId: number = 0;
  private isDisposed: boolean = false;
  private animTime: number = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;

    // 1. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
    this.renderer.shadowMap.enabled = !isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060812);
    this.scene.fog = new THREE.FogExp2(0x060812, 0.04);

    this.camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || 800) / (container.clientHeight || 500),
      0.1,
      60
    );
    this.camera.position.copy(this.baseCamPos);

    // 3. Environment Map (PMREMGenerator + RoomEnvironment)
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    const envTexture = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTexture;

    // 4. Build Arena, Lighting, Fighters & Particles
    this.setupLighting();
    this.buildArenaEnvironment();
    this.setupParticlePool();

    this.playerRig = this.createFighterRig(0x00f0ff, 0xffaa00, 'PLAYER');
    this.opponentRig = this.createFighterRig(0xff0055, 0x111116, 'OPPONENT');

    this.scene.add(this.playerRig.root);
    this.scene.add(this.opponentRig.root);

    // Handle Resize
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  private setupLighting(): void {
    // Warm key directional light
    const keyLight = new THREE.DirectionalLight(0xfff0dd, 2.0);
    keyLight.position.set(4, 9, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7;
    keyLight.shadow.camera.bottom = -7;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    // Cool rim light
    const rimLight = new THREE.DirectionalLight(0x00c8ff, 1.4);
    rimLight.position.set(-6, 4, -5);
    this.scene.add(rimLight);

    // Subtle ambient fill
    const hemiLight = new THREE.HemisphereLight(0x2a3560, 0x080816, 0.85);
    this.scene.add(hemiLight);

    // Under-floor neon point light
    const floorGlow = new THREE.PointLight(0x00e1ff, 2.5, 12, 1.8);
    floorGlow.position.set(0, -0.2, 0);
    this.scene.add(floorGlow);
  }

  private buildArenaEnvironment(): void {
    // 1. Procedural Grid Floor Texture
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fctx = floorCanvas.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#0a0d18';
      fctx.fillRect(0, 0, 512, 512);

      // Subtle hexagonal / grid lines
      fctx.strokeStyle = '#1a2744';
      fctx.lineWidth = 2;
      const step = 32;
      for (let x = 0; x <= 512; x += step) {
        fctx.beginPath();
        fctx.moveTo(x, 0);
        fctx.lineTo(x, 512);
        fctx.stroke();
      }
      for (let y = 0; y <= 512; y += step) {
        fctx.beginPath();
        fctx.moveTo(0, y);
        fctx.lineTo(512, y);
        fctx.stroke();
      }

      // Neon center circle
      fctx.strokeStyle = '#00f0ff';
      fctx.lineWidth = 4;
      fctx.beginPath();
      fctx.arc(256, 256, 180, 0, Math.PI * 2);
      fctx.stroke();
    }

    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(4, 4);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // Main octagonal fighting platform
    const platformGeo = new THREE.CylinderGeometry(6.5, 7.2, 0.4, 8);
    const platformMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.35,
      metalness: 0.55,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.2;
    platform.receiveShadow = !isSoftwareGl;
    this.scene.add(platform);

    // Neon boundary ring around platform
    const ringGeo = new THREE.TorusGeometry(6.55, 0.05, 12, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    // Perimeter energy pillars (4 units on outer edges)
    const pillarGeo = new THREE.CylinderGeometry(0.2, 0.3, 4, 6);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x141829,
      roughness: 0.3,
      metalness: 0.8,
    });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const pillarCoords = [
      [-6, -4],
      [6, -4],
      [-7, 1],
      [7, 1],
      [-4, 5],
      [4, 5],
    ];

    pillarCoords.forEach(([px, pz]) => {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 1.8, pz);
      pillar.castShadow = !isSoftwareGl;
      this.scene.add(pillar);

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), beaconMat);
      beacon.position.set(px, 3.85, pz);
      this.scene.add(beacon);
    });
  }

  /**
   * Procedural composite humanoid fighter mesh (3-12 distinct parts)
   */
  private createFighterRig(accentColor: number, armorColor: number, name: string): FighterMeshRig {
    const root = new THREE.Group();
    root.name = name;

    const armorMat = new THREE.MeshStandardMaterial({
      color: armorColor,
      roughness: 0.45,
      metalness: 0.65,
    });

    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x1f2333,
      roughness: 0.6,
      metalness: 0.3,
    });

    const visorMat = new THREE.MeshBasicMaterial({
      color: accentColor,
    });

    // 1. Torso / Chest Armor
    const torsoGeo = new THREE.BoxGeometry(0.7, 0.85, 0.45);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.y = 1.35;
    torso.castShadow = !isSoftwareGl;
    root.add(torso);

    // Glowing chest emblem / power core
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), visorMat);
    core.rotation.x = Math.PI / 2;
    core.position.set(0, 0.08, 0.24);
    torso.add(core);

    // 2. Head & Visor
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.6, 0);
    torso.add(headGroup);

    const helmetGeo = new THREE.BoxGeometry(0.42, 0.45, 0.42);
    const helmet = new THREE.Mesh(helmetGeo, armorMat);
    helmet.castShadow = !isSoftwareGl;
    headGroup.add(helmet);

    const visorGeo = new THREE.BoxGeometry(0.36, 0.14, 0.1);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.04, 0.22);
    headGroup.add(visor);

    // 3. Left Arm (Shoulder -> Bicep -> Elbow -> Forearm -> Fist)
    const leftArm = new THREE.Group();
    leftArm.position.set(0.48, 0.3, 0);
    torso.add(leftArm);

    const shoulderPauldron = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), armorMat);
    leftArm.add(shoulderPauldron);

    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.36, 10), jointMat);
    bicep.position.y = -0.18;
    leftArm.add(bicep);

    const leftForearm = new THREE.Group();
    leftForearm.position.set(0, -0.36, 0);
    leftArm.add(leftForearm);

    const forearmMeshL = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.34, 10), armorMat);
    forearmMeshL.position.y = -0.16;
    leftForearm.add(forearmMeshL);

    const leftFist = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), visorMat);
    leftFist.position.set(0, -0.36, 0);
    leftForearm.add(leftFist);

    // 4. Right Arm
    const rightArm = new THREE.Group();
    rightArm.position.set(-0.48, 0.3, 0);
    torso.add(rightArm);

    const rightShoulderPauldron = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), armorMat);
    rightArm.add(rightShoulderPauldron);

    const rightBicep = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.36, 10), jointMat);
    rightBicep.position.y = -0.18;
    rightArm.add(rightBicep);

    const rightForearm = new THREE.Group();
    rightForearm.position.set(0, -0.36, 0);
    rightArm.add(rightForearm);

    const forearmMeshR = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.34, 10), armorMat);
    forearmMeshR.position.y = -0.16;
    rightForearm.add(forearmMeshR);

    const rightFist = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), visorMat);
    rightFist.position.set(0, -0.36, 0);
    rightForearm.add(rightFist);

    // 5. Legs (Left & Right)
    const leftLeg = new THREE.Group();
    leftLeg.position.set(0.22, -0.42, 0);
    torso.add(leftLeg);

    const leftThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.44, 10), armorMat);
    leftThigh.position.y = -0.22;
    leftLeg.add(leftThigh);

    const leftCalf = new THREE.Group();
    leftCalf.position.set(0, -0.44, 0);
    leftLeg.add(leftCalf);

    const leftShin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.44, 10), jointMat);
    leftShin.position.y = -0.22;
    leftCalf.add(leftShin);

    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), armorMat);
    leftBoot.position.set(0, -0.44, 0.06);
    leftCalf.add(leftBoot);

    const rightLeg = new THREE.Group();
    rightLeg.position.set(-0.22, -0.42, 0);
    torso.add(rightLeg);

    const rightThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.44, 10), armorMat);
    rightThigh.position.y = -0.22;
    rightLeg.add(rightThigh);

    const rightCalf = new THREE.Group();
    rightCalf.position.set(0, -0.44, 0);
    rightLeg.add(rightCalf);

    const rightShin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.44, 10), jointMat);
    rightShin.position.y = -0.22;
    rightCalf.add(rightShin);

    const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), armorMat);
    rightBoot.position.set(0, -0.44, 0.06);
    rightCalf.add(rightBoot);

    // 6. Contact Shadow Disc beneath feet
    const shadowGeo = new THREE.CircleGeometry(0.65, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.015;
    this.scene.add(shadowDisc);

    return {
      root,
      torso,
      head: headGroup,
      visor,
      leftArm,
      leftForearm,
      leftFist,
      rightArm,
      rightForearm,
      rightFist,
      leftLeg,
      leftCalf,
      rightLeg,
      rightCalf,
      shadowDisc,
      hitFlashTimer: 0,
    };
  }

  private setupParticlePool(): void {
    const geo = new THREE.SphereGeometry(0.06, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe600 });
    this.particleMesh = new THREE.InstancedMesh(geo, mat, this.particleCount);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    for (let i = 0; i < this.particleCount; i++) {
      this.particleData.push({
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.3,
        color: new THREE.Color(0xffe600),
      });
      this.dummyMatrix.makeTranslation(0, -100, 0);
      this.particleMesh.setMatrixAt(i, this.dummyMatrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  public spawnHitSparks(pos: { x: number; y: number; z: number }, isBlocked: boolean): void {
    let spawned = 0;
    const countToSpawn = isBlocked ? 8 : 16;
    const color = isBlocked ? new THREE.Color(0x00f0ff) : new THREE.Color(0xffaa00);

    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particleData[i];
      if (p.life <= 0) {
        p.pos.set(pos.x, pos.y, pos.z);
        p.vel.set(
          (Math.random() - 0.5) * 6,
          Math.random() * 4 + 1.5,
          (Math.random() - 0.5) * 4
        );
        p.life = 0.35;
        p.maxLife = 0.35;
        p.color = color;
        spawned++;
        if (spawned >= countToSpawn) break;
      }
    }

    // Add camera trauma shake
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + (isBlocked ? 0.15 : 0.4));
  }

  private updateParticles(dt: number): void {
    let needsUpdate = false;
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particleData[i];
      if (p.life > 0) {
        p.life -= dt;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.y -= 9.8 * dt; // gravity

        const scale = Math.max(0, p.life / p.maxLife);
        this.dummyMatrix.makeScale(scale, scale, scale);
        this.dummyMatrix.setPosition(p.pos);
        this.particleMesh.setMatrixAt(i, this.dummyMatrix);
        needsUpdate = true;
      } else if (p.pos.y > -50) {
        p.pos.set(0, -100, 0);
        this.dummyMatrix.makeTranslation(0, -100, 0);
        this.particleMesh.setMatrixAt(i, this.dummyMatrix);
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Procedural animation synthesis per fighter state
   */
  private animateFighter(rig: FighterMeshRig, f: FighterState, dt: number, isPlayer: boolean): void {
    const root = rig.root;
    // Set position and orientation
    root.position.x = f.position.x;
    root.position.y = f.position.y;
    root.position.z = f.position.z;

    // Face each other (+1 faces right, -1 faces left)
    const targetRotY = f.facingDirection === 1 ? Math.PI / 2 : -Math.PI / 2;
    root.rotation.y = targetRotY;

    // Update ground contact shadow
    rig.shadowDisc.position.x = f.position.x;
    rig.shadowDisc.position.z = f.position.z;

    // Breathing / idle stance bobbing
    const idleBob = Math.sin(this.animTime * 4) * 0.03;
    rig.torso.position.y = 1.35 + idleBob;

    // Default fighter ready stance angles
    let lShoulderX = 0.4;
    let lElbowX = -0.9;
    let rShoulderX = 0.4;
    let rElbowX = -0.9;
    let torsoTiltZ = 0;
    let headTiltX = 0;

    // Action animation state machine
    switch (f.currentAction) {
      case 'LEFT_PUNCH':
      case 'LEFT_HOOK': {
        const isHook = f.currentAction === 'LEFT_HOOK';
        if (f.actionPhase === 'WINDUP') {
          lShoulderX = -0.2;
          lElbowX = -1.5;
          torsoTiltZ = 0.1;
        } else if (f.actionPhase === 'ACTIVE') {
          lShoulderX = 1.45;
          lElbowX = isHook ? -0.8 : -0.15; // full extension for jab, curved for hook
          torsoTiltZ = -0.2;
        } else if (f.actionPhase === 'RECOVERY') {
          lShoulderX = 0.7;
          lElbowX = -0.7;
        }
        break;
      }

      case 'RIGHT_PUNCH':
      case 'RIGHT_HOOK': {
        const isHook = f.currentAction === 'RIGHT_HOOK';
        if (f.actionPhase === 'WINDUP') {
          rShoulderX = -0.3;
          rElbowX = -1.6;
          torsoTiltZ = -0.1;
        } else if (f.actionPhase === 'ACTIVE') {
          rShoulderX = 1.5;
          rElbowX = isHook ? -0.8 : -0.15;
          torsoTiltZ = 0.25;
        } else if (f.actionPhase === 'RECOVERY') {
          rShoulderX = 0.7;
          rElbowX = -0.7;
        }
        break;
      }

      case 'BLOCK': {
        lShoulderX = 0.95;
        lElbowX = -1.75;
        rShoulderX = 0.95;
        rElbowX = -1.75;
        headTiltX = 0.2;
        break;
      }

      case 'DODGE_LEFT': {
        torsoTiltZ = -0.45;
        break;
      }

      case 'DODGE_RIGHT': {
        torsoTiltZ = 0.45;
        break;
      }

      case 'KICK': {
        if (f.actionPhase === 'ACTIVE') {
          rig.rightLeg.rotation.x = -1.55;
          rig.rightCalf.rotation.x = 0.1;
          torsoTiltZ = -0.3;
        }
        break;
      }

      case 'STUN': {
        headTiltX = -0.4;
        torsoTiltZ = -f.facingDirection * 0.3;
        lShoulderX = -0.4;
        rShoulderX = -0.4;
        break;
      }

      case 'KO': {
        // Collapsed to ground
        root.rotation.z = THREE.MathUtils.damp(root.rotation.z, -f.facingDirection * (Math.PI / 2), 6, dt);
        rig.torso.position.y = THREE.MathUtils.damp(rig.torso.position.y, 0.3, 6, dt);
        return;
      }
    }

    // Reset leg rotation if not kicking
    if (f.currentAction !== 'KICK') {
      rig.rightLeg.rotation.x = THREE.MathUtils.damp(rig.rightLeg.rotation.x, 0, 10, dt);
      rig.rightCalf.rotation.x = THREE.MathUtils.damp(rig.rightCalf.rotation.x, 0, 10, dt);
    }

    // Smooth limb damping
    rig.leftArm.rotation.x = THREE.MathUtils.damp(rig.leftArm.rotation.x, lShoulderX, 18, dt);
    rig.leftForearm.rotation.x = THREE.MathUtils.damp(rig.leftForearm.rotation.x, lElbowX, 18, dt);
    rig.rightArm.rotation.x = THREE.MathUtils.damp(rig.rightArm.rotation.x, rShoulderX, 18, dt);
    rig.rightForearm.rotation.x = THREE.MathUtils.damp(rig.rightForearm.rotation.x, rElbowX, 18, dt);
    rig.torso.rotation.z = THREE.MathUtils.damp(rig.torso.rotation.z, torsoTiltZ, 14, dt);
    rig.head.rotation.x = THREE.MathUtils.damp(rig.head.rotation.x, headTiltX, 12, dt);
  }

  /**
   * Main render call invoked each frame
   */
  public render(player: FighterState, opponent: FighterState, dt: number): void {
    if (this.isDisposed) return;
    this.animTime += dt;

    // Update fighter animations
    this.animateFighter(this.playerRig, player, dt, true);
    this.animateFighter(this.opponentRig, opponent, dt, false);

    // Update hit particle pool
    this.updateParticles(dt);

    // Dynamic 2.5D Camera Tracking
    const midX = (player.position.x + opponent.position.x) / 2;
    const fighterDist = Math.abs(player.position.x - opponent.position.x);

    _camTarget.set(midX, 1.35, 0);

    // Camera zooms slightly to keep both fighters framed
    const targetCamZ = Math.max(6.2, 5.0 + fighterDist * 0.45);
    const targetCamX = midX * 0.65;

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, targetCamX, 5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, targetCamZ, 5, dt);

    // Apply trauma camera shake
    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 2.2);
      const shakeAmt = this.cameraTrauma * this.cameraTrauma * 0.18;
      this.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y = 2.35 + (Math.random() - 0.5) * shakeAmt;
    } else {
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, 2.35, 5, dt);
    }

    this.camera.lookAt(_camTarget);

    // Render WebGL frame
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    if (!this.container || this.isDisposed) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public dispose(): void {
    this.isDisposed = true;
    window.removeEventListener('resize', this.onResize);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.pmremGenerator.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
