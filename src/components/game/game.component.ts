
/*
 * PROJECT: Gesture Racer 3D
 * AUTHOR: Soumoditya Das (soumoditt@gmail.com)
 * DESCRIPTION: A computer vision-based racing game using Angular, Three.js, and MediaPipe.
 * COPYRIGHT: (c) 2024 Soumoditya Das. All Rights Reserved.
 * 
 * NOTE TO DEVELOPERS:
 * This code is self-contained for the game logic. Ensure camera permissions are granted.
 * To run locally, serve via HTTPS or localhost.
 */

import { Component, ChangeDetectionStrategy, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

// Access THREE from global scope (Loaded via CDN in index.html)
declare const THREE: any;

enum DriveState {
  IDLE = 'NEUTRAL',
  ACCELERATING = 'GAS',
  BRAKING = 'BRAKING'
}

enum SteeringState {
  STRAIGHT = 'STRAIGHT',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  DRIFT_LEFT = 'DRIFT LEFT',
  DRIFT_RIGHT = 'DRIFT RIGHT'
}

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('webcamVideo') video!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;

  // --- Game State Signals ---
  gameState = signal<'IDLE' | 'LOADING' | 'RUNNING' | 'GAME_OVER'>('IDLE');
  loadingMessage = signal('System Initialization...');
  
  // Scoring
  score = signal(0);
  highScore = signal(0);
  lastScore = signal(0);
  
  // Physics & Control
  currentDriveState = signal<DriveState>(DriveState.IDLE);
  currentSteerState = signal<SteeringState>(SteeringState.STRAIGHT);
  speedKph = signal(0);
  currentGear = signal(1); // 1 to 6
  distanceTraveled = 0;
  
  // --- Computer Vision ---
  handLandmarker: any = undefined;
  webcamRunning = false;

  // --- 3D Graphics (Three.js) ---
  private scene: any;
  private camera: any;
  private renderer: any;
  private clock: any;

  // 3D Objects
  private carGroup: any;
  private roadMesh: any;
  private envGroup: any; 
  private obstacleGroup: any; 
  private particleGroup: any; 
  private groundMesh: any;
  private skyColor: any;

  // Physics Logic
  private speed = 0; 
  private maxSpeed = 4.8; 
  private carX = 0; 
  private targetCarX = 0; 
  
  // Drifting Specifics
  private driftFactor = 0; // 0 to 1 intensity
  private driftDirection = 0; // -1 Left, 1 Right
  
  // --- Audio Engine ---
  private audioCtx: AudioContext | null = null;
  private engineSource: AudioBufferSourceNode | null = null;
  private engineBuffer: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private driftOsc: OscillatorNode | null = null;
  private driftGain: GainNode | null = null;
  
  // Loop Handles
  private detectionFrameId: number | null = null;
  private animationFrameId: number | null = null;

  constructor() {
    this.loadStats();
  }

  ngAfterViewInit(): void {
    // The video element is now persistent in DOM
  }

  // --- Local Storage Persistence ---
  loadStats() {
    try {
        const savedHigh = localStorage.getItem('soumoditya_racer_highScore');
        const savedLast = localStorage.getItem('soumoditya_racer_lastScore');
        if (savedHigh) this.highScore.set(parseInt(savedHigh, 10));
        if (savedLast) this.lastScore.set(parseInt(savedLast, 10));
    } catch (e) { console.warn("Storage access failed", e); }
  }

  saveStats() {
    try {
        localStorage.setItem('soumoditya_racer_lastScore', this.score().toString());
        this.lastScore.set(this.score());
        if (this.score() > this.highScore()) {
            this.highScore.set(this.score());
            localStorage.setItem('soumoditya_racer_highScore', this.score().toString());
        }
    } catch (e) {}
  }

  // --- MAIN ENTRY POINT ---
  async startGame(): Promise<void> {
    this.gameState.set('LOADING');
    this.loadingMessage.set('Checking System Capabilities...');
    
    try {
      if (!this.audioCtx) await this.initAudio();
      
      if (!this.handLandmarker) {
          this.loadingMessage.set('Initializing Computer Vision (MediaPipe)...');
          await this.setupHandLandmarker();
          this.loadingMessage.set('Requesting Camera Access...');
          await this.setupWebcam();
      }

      this.loadingMessage.set('Generating 3D Environment...');
      this.initThreeJS();
      
      this.restartGame();
      if (!this.detectionFrameId) this.predictWebcam();

    } catch (error: any) {
      console.error("Game Startup Error [Soumoditya]:", error);
      let msg = 'Error: System Failure.';
      if (error.name === 'NotAllowedError' || error.message.includes('permission')) {
          msg = 'Error: Camera Permission Denied. Please allow access.';
      } else if (error.name === 'NotFoundError') {
          msg = 'Error: No Camera Found.';
      } else if (!window.isSecureContext) {
          msg = 'Error: HTTPS Required for Camera.';
      }
      this.loadingMessage.set(msg);
    }
  }

  // --- AUDIO SYSTEM ---
  async initAudio(): Promise<void> {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContext();

    const engineUrl = 'https://raw.githubusercontent.com/jakesgordon/javascript-racer/master/sounds/engine.mp3';
    try {
        const response = await fetch(engineUrl);
        const arrayBuffer = await response.arrayBuffer();
        this.engineBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) { 
        console.warn("Audio Asset Failed. Game will be silent.", e); 
    }

    this.driftOsc = this.audioCtx.createOscillator();
    this.driftOsc.type = 'sawtooth';
    this.driftOsc.frequency.value = 80;
    this.driftGain = this.audioCtx.createGain();
    this.driftGain.gain.value = 0;
    this.driftOsc.connect(this.driftGain);
    this.driftGain.connect(this.audioCtx.destination);
    this.driftOsc.start();
  }

  startEngineSound(): void {
    if (!this.audioCtx || !this.engineBuffer) return;
    if (this.engineSource) try { this.engineSource.stop(); } catch(e){}

    this.engineSource = this.audioCtx.createBufferSource();
    this.engineSource.buffer = this.engineBuffer;
    this.engineSource.loop = true;

    this.engineGain = this.audioCtx.createGain();
    this.engineGain.gain.value = 0.1; 

    this.engineSource.connect(this.engineGain);
    this.engineGain.connect(this.audioCtx.destination);
    this.engineSource.start(0);
  }

  updateAudio(dt: number): void {
    if (!this.audioCtx || !this.engineSource || !this.engineGain) return;
    
    const kph = this.speedKph();
    let gear = 1;
    let minSpeed = 0;
    let maxSpeedForGear = 80;

    // --- GEAR LOGIC (Soumoditya's Tuning) ---
    if (kph < 80) { gear = 1; minSpeed = 0; maxSpeedForGear = 80; }
    else if (kph < 160) { gear = 2; minSpeed = 80; maxSpeedForGear = 160; }
    else if (kph < 220) { gear = 3; minSpeed = 160; maxSpeedForGear = 220; }
    else if (kph < 280) { gear = 4; minSpeed = 220; maxSpeedForGear = 280; }
    else if (kph < 340) { gear = 5; minSpeed = 280; maxSpeedForGear = 340; }
    else { gear = 6; minSpeed = 340; maxSpeedForGear = 450; }

    this.currentGear.set(gear);

    let rpm = (kph - minSpeed) / (maxSpeedForGear - minSpeed);
    rpm = Math.max(0.3, Math.min(1, rpm));

    // RPM flares when drifting
    if (this.driftFactor > 0.5) rpm = Math.min(1.0, rpm + 0.2);

    const basePitch = 0.6 + (gear * 0.05); 
    const pitchRange = 0.7; 
    const targetPitch = basePitch + (rpm * pitchRange);

    this.engineSource.playbackRate.setTargetAtTime(targetPitch, this.audioCtx.currentTime, 0.1);
    
    const load = this.currentDriveState() === DriveState.ACCELERATING ? 0.3 : 0.0;
    const targetVol = 0.15 + (this.speed * 0.1) + load;
    this.engineGain.gain.setTargetAtTime(targetVol, this.audioCtx.currentTime, 0.1);

    if (this.driftGain) {
        // Drift sound linked to drift factor
        const driftVol = this.driftFactor * 0.5;
        this.driftGain.gain.setTargetAtTime(driftVol, this.audioCtx.currentTime, 0.1);
    }
  }

  playCrashSound(): void {
    if (!this.audioCtx) return;
    const bufferSize = this.audioCtx.sampleRate * 1.5; 
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2); 
    }

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 1.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioCtx.destination);
    noise.start();
  }

  stopAudio(): void {
    if (this.engineSource) {
        try { this.engineSource.stop(); } catch(e){}
        this.engineSource = null;
    }
    if (this.driftGain) this.driftGain.gain.value = 0;
  }

  // --- THREE.JS GRAPHICS ENGINE ---
  initThreeJS(): void {
    if (this.scene) return; 

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.scene = new THREE.Scene();
    
    this.skyColor = new THREE.Color(0x87CEEB);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.skyColor, 20, 200);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500);
    this.camera.position.set(0, 5, 8);
    this.camera.lookAt(0, 0, -20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    
    this.canvasContainer.nativeElement.innerHTML = '';
    this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9); 
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(-50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(sunLight);

    this.envGroup = new THREE.Group();
    this.scene.add(this.envGroup);
    
    this.obstacleGroup = new THREE.Group();
    this.scene.add(this.obstacleGroup);

    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);

    this.createCar();
    this.createWorld();

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  createCar(): void {
    this.carGroup = new THREE.Group();
    // HERO CAR - Detailed
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe60000, roughness: 0.2, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.0, metalness: 0.8 });
    
    // Main Chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.4), bodyMat);
    chassis.position.y = 0.6;
    chassis.castShadow = true;
    this.carGroup.add(chassis);

    // Upper Cabin (Slanted)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2.2), glassMat);
    cabin.position.set(0, 1.1, -0.3);
    this.carGroup.add(cabin);

    // Spoiler
    const spoilerPostL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), bodyMat);
    spoilerPostL.position.set(0.6, 1.0, 2.0);
    const spoilerPostR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), bodyMat);
    spoilerPostR.position.set(-0.6, 1.0, 2.0);
    const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.6), bodyMat);
    spoilerWing.position.set(0, 1.2, 2.0);
    this.carGroup.add(spoilerPostL, spoilerPostR, spoilerWing);

    // Rear Lights (Glowing)
    const tailLightGeo = new THREE.BoxGeometry(0.6, 0.15, 0.1);
    const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 });
    const tl = new THREE.Mesh(tailLightGeo, tailLightMat);
    tl.position.set(-0.6, 0.7, 2.21);
    const tr = new THREE.Mesh(tailLightGeo, tailLightMat);
    tr.position.set(0.6, 0.7, 2.21);
    this.carGroup.add(tl, tr);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.45, 24);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    
    [ {x:1.05, z:1.3}, {x:-1.05, z:1.3}, {x:1.05, z:-1.3}, {x:-1.05, z:-1.3} ].forEach(pos => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(pos.x, 0.38, pos.z);
        this.carGroup.add(w);
    });

    // Shadow
    const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 4.8),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
    );
    shadow.rotation.x = -Math.PI/2;
    shadow.position.y = 0.05;
    this.carGroup.add(shadow);

    this.scene.add(this.carGroup);
  }

  // --- TRAFFIC GENERATOR ---
  createNPCMesh(type: 'SEDAN' | 'TRUCK' | 'SPORT', colorHex: number): any {
     const npc = new THREE.Group();
     const mainColor = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.3 });
     const glass = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.1 });
     const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
     
     if (type === 'SEDAN') {
         const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), mainColor);
         body.position.y = 0.6;
         body.castShadow = true;
         
         const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.0), glass);
         top.position.set(0, 1.2, 0);
         
         npc.add(body, top);
     } 
     else if (type === 'TRUCK') {
         const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 5.0), new THREE.MeshStandardMaterial({ color: 0x333333 }));
         chassis.position.y = 0.8;
         chassis.castShadow = true;
         
         const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 1.5), mainColor);
         cab.position.set(0, 1.6, -1.5);
         
         const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 3.0), mainColor);
         cargo.position.set(0, 1.5, 1.0);

         npc.add(chassis, cab, cargo);
     }
     else if (type === 'SPORT') {
         const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.0), mainColor);
         body.position.y = 0.5;
         body.castShadow = true;

         const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.5), glass);
         top.position.set(0, 0.95, -0.2);
         
         // Spoiler
         const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.4), new THREE.MeshStandardMaterial({color:0x111111}));
         wing.position.set(0, 1.0, 1.8);
         
         npc.add(body, top, wing);
     }

     // Common Parts: Wheels
     const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
     wGeo.rotateZ(Math.PI/2);
     const positions = [ {x:0.9, z:1.2}, {x:-0.9, z:1.2}, {x:0.9, z:-1.2}, {x:-0.9, z:-1.2} ];
     
     // Adjust for Truck
     if (type === 'TRUCK') {
         positions.push({x:0.9, z:0}, {x:-0.9, z:0}); // 6 wheeler
     }

     positions.forEach(p => {
         const w = new THREE.Mesh(wGeo, wheelMat);
         w.position.set(p.x, 0.4, p.z);
         npc.add(w);
     });

     // Lights
     const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
     const tlMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
     
     // Front
     const hl1 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), hlMat);
     hl1.position.set(-0.6, 0.8, -2.1); 
     if (type === 'TRUCK') hl1.position.z = -2.5; // adjust for truck length
     if (type === 'SEDAN') hl1.position.z = -2.11;
     if (type === 'SPORT') hl1.position.z = -2.01;
     hl1.rotation.y = Math.PI;
     
     const hl2 = hl1.clone();
     hl2.position.x = 0.6;
     
     // Back
     const tl1 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), tlMat);
     tl1.position.set(-0.6, 0.8, 2.1);
     if (type === 'TRUCK') tl1.position.z = 2.51;
     if (type === 'SEDAN') tl1.position.z = 2.11;
     if (type === 'SPORT') tl1.position.z = 2.01;

     const tl2 = tl1.clone();
     tl2.position.x = 0.6;

     npc.add(hl1, hl2, tl1, tl2);

     return npc;
  }

  createWorld(): void {
    const roadGeo = new THREE.PlaneGeometry(28, 400);
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
    this.roadMesh = new THREE.Mesh(roadGeo, roadMat);
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.receiveShadow = true;
    this.scene.add(this.roadMesh);

    // Procedural Road Markings
    for (let i = 0; i < 20; i++) {
        const lineGeo = new THREE.PlaneGeometry(0.25, 10);
        const yMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
        
        const c1 = new THREE.Mesh(lineGeo, yMat);
        c1.rotation.x = -Math.PI / 2;
        c1.position.set(-0.3, 0.02, -i * 20);
        this.envGroup.add(c1);
        
        const c2 = new THREE.Mesh(lineGeo, yMat);
        c2.rotation.x = -Math.PI / 2;
        c2.position.set(0.3, 0.02, -i * 20);
        this.envGroup.add(c2);
        
        const wMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const l1 = new THREE.Mesh(lineGeo, wMat);
        l1.rotation.x = -Math.PI / 2;
        l1.position.set(-7, 0.02, -i * 20);
        this.envGroup.add(l1);

        const l2 = new THREE.Mesh(lineGeo, wMat);
        l2.rotation.x = -Math.PI / 2;
        l2.position.set(7, 0.02, -i * 20);
        this.envGroup.add(l2);
    }

    const groundGeo = new THREE.PlaneGeometry(600, 600, 48, 48);
    const pos = groundGeo.attributes.position;
    for(let i=0; i<pos.count; i++) {
        const x = pos.getX(i);
        if (Math.abs(x) > 16) pos.setZ(i, Math.random() * 6 + Math.abs(x) * 0.1); 
    }
    groundGeo.computeVertexNormals();
    this.groundMesh = new THREE.Mesh(
        groundGeo, 
        new THREE.MeshStandardMaterial({ color: 0x55aa55, roughness: 1 })
    );
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = -0.2;
    this.scene.add(this.groundMesh);

    for(let i=0; i<120; i++) this.spawnTree();
    for(let i=0; i<15; i++) this.spawnCloud();
  }

  spawnTree(): void {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.5), new THREE.MeshStandardMaterial({ color: 0x4a3c31 }));
    trunk.position.y = 1.25;
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0), new THREE.MeshStandardMaterial({ color: 0x2e8b57 }));
    leaves.position.y = 4;
    group.add(trunk, leaves);
    
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (20 + Math.random() * 150);
    const z = (Math.random() * 400) - 200;
    group.position.set(x, 0, z);
    const s = 1.0 + Math.random() * 0.8;
    group.scale.set(s,s,s);
    this.envGroup.add(group);
  }

  spawnCloud(): void {
     const geo = new THREE.DodecahedronGeometry(12);
     const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
     const cloud = new THREE.Mesh(geo, mat);
     cloud.position.set((Math.random()-0.5)*500, 60+Math.random()*40, (Math.random()*400)-200);
     this.envGroup.add(cloud);
  }

  // --- GAME LOOP ---
  restartGame(): void {
    this.score.set(0);
    this.speed = 0;
    this.distanceTraveled = 0;
    this.carX = 0;
    this.targetCarX = 0;
    this.driftFactor = 0;
    this.currentDriveState.set(DriveState.IDLE);
    this.gameState.set('RUNNING');

    this.obstacleGroup.clear();
    this.particleGroup.clear();
    
    this.skyColor.setHex(0x87CEEB);
    this.scene.background = this.skyColor;
    this.scene.fog.color = this.skyColor;
    this.groundMesh.material.color.setHex(0x55aa55);

    this.envGroup.children.forEach((c: any) => {
        if (c.position.z > 50) c.position.z -= 400;
    });

    this.startEngineSound();

    // Initial Safe Traffic
    for(let i=0; i<4; i++) {
        this.spawnTraffic(-80 - (i*60), true);
    }

    this.carGroup.position.set(7, 0, 0); 
    this.carGroup.rotation.set(0, 0, 0);

    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.animate();
  }

  animate(): void {
    if (this.gameState() !== 'RUNNING') return;

    const dt = this.clock.getDelta();
    this.updatePhysics(dt);
    this.updateEnvironment(dt);
    this.updateParticles(dt);
    this.updateAudio(dt);
    this.updateCamera(dt);

    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  updatePhysics(dt: number): void {
    const state = this.currentDriveState();
    
    // Acceleration Logic
    if (state === DriveState.ACCELERATING) {
        const accel = 0.6 * (1.0 - (this.speed / this.maxSpeed) * 0.5);
        this.speed = Math.min(this.maxSpeed, this.speed + accel * dt);
    } else if (state === DriveState.BRAKING) {
        this.speed = Math.max(0, this.speed - 5.0 * dt); 
    } else {
        this.speed = Math.max(0, this.speed - 0.2 * dt);
    }

    const kph = Math.floor(this.speed * 80);
    this.speedKph.set(kph);
    
    // Score increases faster when drifting
    const scoreMult = 1 + (this.driftFactor * 2);
    this.score.update(s => s + Math.floor(this.speed * 15 * scoreMult * dt));
    
    this.distanceTraveled += this.speed * dt;

    // --- ENHANCED DRIFT PHYSICS ---
    // Steering input difference
    let turnInput = this.targetCarX - this.carX;
    
    // Slip Angle Calculation
    // If turning hard at high speed, traction breaks
    const turnMagnitude = Math.abs(turnInput);
    if (this.speed > 1.5 && turnMagnitude > 0.4) {
        // Build up drift
        this.driftFactor = Math.min(1.0, this.driftFactor + dt * 2.0);
        this.driftDirection = turnInput > 0 ? 1 : -1;
    } else {
        // Regain traction
        this.driftFactor = Math.max(0.0, this.driftFactor - dt * 3.0);
    }

    // Apply Lateral Movement
    // When drifting, movement is "looser" (slides more)
    const grip = 1.0 - (this.driftFactor * 0.7); // Less grip = smoother slide
    const response = 5.0 * grip;
    
    this.carX += turnInput * response * dt;
    this.carX = Math.max(-11.5, Math.min(11.5, this.carX));
    this.carGroup.position.x = this.carX;

    // --- VISUAL ROTATION (Slip Angle) ---
    // The car rotates MORE than the movement direction to simulate oversteer
    // Base turn lean
    let targetRotZ = -turnInput * 0.10;
    let targetRotY = -turnInput * 0.05;

    // Add Drift Oversteer to Y Rotation
    if (this.driftFactor > 0.1) {
        // If drifting right, car nose points right (negative Y rot in ThreeJS sometimes depending on orientation, 
        // here we want the tail to slide out)
        // Visually: Tail slides OUT (opposite to turn). 
        // Actually for a drift: Nose points IN to turn, Car vector is OUT. 
        // We simulate this by rotating the mesh deeply into the turn.
        targetRotY -= (this.driftDirection * this.driftFactor * 0.4);
        
        // Spawn Tire Smoke
        this.spawnExhaust(0.7, 0xaaaaaa, true);
        this.spawnExhaust(-0.7, 0xaaaaaa, true);
    } 
    else if (this.speed > 2.0 && state === DriveState.ACCELERATING) {
        // Normal Exhaust
        if (Math.random() < 0.3) {
            this.spawnExhaust(0.5, 0xffffff);
            this.spawnExhaust(-0.5, 0xffffff);
        }
    }

    this.carGroup.rotation.z = targetRotZ;
    this.carGroup.rotation.y = targetRotY;

    // Update HUD State
    if (this.driftFactor > 0.5) {
        this.currentSteerState.set(this.driftDirection > 0 ? SteeringState.DRIFT_RIGHT : SteeringState.DRIFT_LEFT);
    } else {
        if (turnInput > 0.2) this.currentSteerState.set(SteeringState.RIGHT);
        else if (turnInput < -0.2) this.currentSteerState.set(SteeringState.LEFT);
        else this.currentSteerState.set(SteeringState.STRAIGHT);
    }
  }

  updateEnvironment(dt: number): void {
    const moveDist = this.speed * 40 * dt;
    const currentScore = this.score();
    
    // Progressive Difficulty
    const difficulty = 1 + Math.min(2, currentScore / 5000);
    
    // Day/Night Cycle based on score
    if (this.skyColor) {
        const progress = Math.min(1, currentScore / 10000);
        this.skyColor.setHSL(0.55 + (0.3 * progress), 0.6, 0.6 - (0.4 * progress));
        this.scene.background = this.skyColor;
        this.scene.fog.color = this.skyColor;
    }

    this.envGroup.children.forEach((obj: any) => {
        obj.position.z += moveDist;
        if (obj.position.z > 50) {
            obj.position.z -= 400;
            if (obj.geometry && obj.geometry.type !== 'PlaneGeometry') {
                 const xSide = obj.position.x > 0 ? 1 : -1;
                 obj.position.x = xSide * (20 + Math.random() * 100);
            }
        }
    });

    // Traffic AI
    const spawnChance = 0.01 + (difficulty * 0.015);
    if (Math.random() < spawnChance) this.spawnTraffic(-250);

    const toRemove: any[] = [];
    
    this.obstacleGroup.children.forEach((car: any) => {
        const lane = car.userData.lane;
        let carSpeed = 0;

        if (lane < 0) {
            carSpeed = (this.speed * 40) + (30 * difficulty); // Oncoming
        } else {
            carSpeed = (this.speed * 40) - 15; // Same way
            if (this.speed < 0.5) carSpeed = -30;
        }

        car.position.z += carSpeed * dt;

        // Smart Lane Changing AI
        if (!car.userData.changingLane && Math.random() < (0.005 * difficulty)) {
            const currentLane = car.userData.targetLane || lane;
            if (currentLane > 0) {
                car.userData.targetLane = currentLane === 2.5 ? 7 : 2.5;
                car.userData.changingLane = true;
            }
        }

        if (car.userData.changingLane) {
            const target = car.userData.targetLane;
            car.position.x += (target - car.position.x) * 2.0 * dt;
            car.rotation.y = (target - car.position.x) * -0.1;
            
            if (Math.abs(car.position.x - target) < 0.1) {
                car.position.x = target;
                car.userData.lane = target; 
                car.rotation.y = 0;
                car.userData.changingLane = false;
            }
        }

        // Improved Collision Box
        // Since we have models now, use a slightly tighter box
        if (Math.abs(car.position.z - this.carGroup.position.z) < 3.5 && 
            Math.abs(car.position.x - this.carGroup.position.x) < 1.8) {
            this.crash();
        }

        if (car.position.z > 50 || car.position.z < -450) toRemove.push(car);
    });
    toRemove.forEach(c => this.obstacleGroup.remove(c));
  }

  spawnTraffic(zPos: number, safeMode = false): void {
    const lanes = [-7, -2.5, 2.5, 7];
    const chosenLanes = safeMode ? [-7, 7] : lanes;
    const lane = chosenLanes[Math.floor(Math.random() * chosenLanes.length)];
    
    for (const c of this.obstacleGroup.children) {
        if (Math.abs(c.position.z - zPos) < 30) return;
    }

    const colors = [0xff0000, 0x0000ff, 0xeeee00, 0xffffff, 0x111111, 0x00ff00, 0xff00ff];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    // Random Type
    const types: ('SEDAN' | 'TRUCK' | 'SPORT')[] = ['SEDAN', 'SEDAN', 'TRUCK', 'SPORT'];
    const type = types[Math.floor(Math.random() * types.length)];

    const mesh = this.createNPCMesh(type, color);
    mesh.position.set(lane, 0, zPos);
    
    // Rotate 180 if oncoming
    if (lane < 0) {
        mesh.rotation.y = Math.PI;
    }

    mesh.userData = { lane, targetLane: lane, changingLane: false };
    this.obstacleGroup.add(mesh);
  }

  spawnExhaust(xOff: number, color: number, isSmoke = false): void {
    const size = isSmoke ? 0.4 : 0.15;
    const opacity = isSmoke ? 0.3 : 0.6;
    
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    const p = new THREE.Mesh(geo, mat);
    
    // Smoke comes from tires, exhaust from pipes
    const yPos = isSmoke ? 0.2 : 0.5;
    const zPos = isSmoke ? 1.5 : 2.5;

    p.position.set(this.carGroup.position.x + xOff, yPos, zPos);
    
    // Smoke expands, exhaust shoots back
    const expansion = isSmoke ? 1.05 : 1.0;
    
    p.userData = { 
        life: 0.4, 
        vel: new THREE.Vector3((Math.random()-0.5)*0.2, Math.random()*0.2, isSmoke ? 2 : 5),
        expansion
    };
    this.particleGroup.add(p);
  }

  updateParticles(dt: number): void {
    const dead: any[] = [];
    this.particleGroup.children.forEach((p: any) => {
        p.userData.life -= dt;
        p.position.addScaledVector(p.userData.vel, dt * 10);
        
        if (p.userData.expansion > 1.0) {
             p.scale.multiplyScalar(1.0 + (dt * 2)); // rapid expansion for smoke
             p.rotation.z += dt * 2;
        } else {
             p.scale.multiplyScalar(1.05);
        }

        p.material.opacity = p.userData.life;
        if (p.userData.life <= 0) dead.push(p);
    });
    dead.forEach(d => this.particleGroup.remove(d));
  }

  updateCamera(dt: number): void {
    const targetFov = 60 + (this.speed * 8);
    this.camera.fov += (targetFov - this.camera.fov) * 2 * dt;
    this.camera.updateProjectionMatrix();

    let shakeX = 0;
    let shakeY = 0;
    if (this.speed > 3.0) {
        shakeX = (Math.random() - 0.5) * 0.1;
        shakeY = (Math.random() - 0.5) * 0.1;
    }

    const targetX = this.carX * 0.6;
    
    // Camera Lags behind drift to emphasize angle
    let driftLag = 0;
    if (this.driftFactor > 0.2) {
        driftLag = -this.driftDirection * this.driftFactor * 2.0;
    }

    this.camera.position.x += ((targetX + driftLag) - this.camera.position.x) * 4 * dt + shakeX;
    this.camera.position.y = 5 + (this.speed * 0.3) + shakeY;
    this.camera.position.z = 9 + (this.speed * 1.5);
    this.camera.lookAt(this.carX * 0.4, 0, -30);
  }

  crash(): void {
    this.saveStats();
    this.gameState.set('GAME_OVER');
    this.stopAudio();
    this.playCrashSound();
  }

  // --- COMPUTER VISION & INPUT HANDLING ---
  async setupHandLandmarker(): Promise<void> {
    // Dynamic Import for CDN robustness
    // @ts-ignore
    const { FilesetResolver, HandLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/+esm');
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2
    });
  }

  async setupWebcam(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser API 'navigator.mediaDevices' is missing. Ensure you are using HTTPS or localhost.");
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (!this.video || !this.video.nativeElement) throw new Error("Video Element not initialized in DOM.");
        this.video.nativeElement.srcObject = stream;
        return new Promise((resolve) => {
            this.video.nativeElement.addEventListener("loadeddata", () => {
                this.webcamRunning = true;
                resolve();
            });
        });
    } catch (err) { throw err; }
  }

  async predictWebcam(): Promise<void> {
    if (!this.handLandmarker) return; 
    const videoEl = this.video?.nativeElement;
    if (this.webcamRunning && videoEl && videoEl.videoWidth > 0) {
        const results = this.handLandmarker.detectForVideo(videoEl, performance.now());
        if (results.landmarks) this.processInput(results.landmarks);
    }
    this.detectionFrameId = requestAnimationFrame(() => this.predictWebcam());
  }

  processInput(landmarks: any[][]): void {
    let steerInput = 0;
    let isBraking = false;
    for (const hand of landmarks) { if (this.isFist(hand)) isBraking = true; }

    if (landmarks.length === 0) {
        this.currentDriveState.set(DriveState.IDLE);
    } else if (isBraking) {
        this.currentDriveState.set(DriveState.BRAKING);
    } else {
        this.currentDriveState.set(DriveState.ACCELERATING);
    }

    if (landmarks.length === 2) {
        const h1 = landmarks[0][0];
        const h2 = landmarks[1][0];
        const left = h1.x < h2.x ? h1 : h2;
        const right = h1.x < h2.x ? h2 : h1;
        steerInput = (right.y - left.y) * 5.0;
    } else if (landmarks.length === 1) {
        const hand = landmarks[0];
        const wrist = hand[0];
        const mid = hand[9];
        steerInput = (mid.x - wrist.x) * -7.0;
    }

    this.targetCarX += steerInput * 0.8;
    this.targetCarX = Math.max(-11.5, Math.min(11.5, this.targetCarX));
  }

  isFist(lm: any[]): boolean {
    const wrist = lm[0];
    const tips = [lm[8], lm[12], lm[16], lm[20]];
    const avgDist = tips.reduce((sum, t) => sum + Math.hypot(t.x - wrist.x, t.y - wrist.y), 0) / 4;
    return avgDist < 0.35; 
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.detectionFrameId) cancelAnimationFrame(this.detectionFrameId);
    this.stopAudio();
    if (this.audioCtx) this.audioCtx.close();
  }
}
