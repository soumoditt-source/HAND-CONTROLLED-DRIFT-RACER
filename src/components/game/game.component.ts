
/*
 * PROJECT: Gesture Racer 3D (Megatronix Edition)
 * AUTHOR: Soumoditya Das & Team Megatronix 2026 (MSIT)
 * VERSION: 9.9.1 (Stability Fixes)
 * 
 * ARCHITECTURE:
 * - Render Loop: 60 FPS (Visuals)
 * - AI Loop: 30 FPS (Throttled)
 * - Preloading: AI Models load in background immediately on app start.
 */

import { Component, ChangeDetectionStrategy, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

// Access THREE from global scope (loaded via CDN)
declare const THREE: any;

// --- CONFIGURATION ---
const BGM_URL = 'https://opengameart.org/sites/default/files/Rolemusic_-_pl4y1ng.mp3'; 
const LERP_FACTOR = 0.1; 
const CV_THROTTLE_MS = 32; 

// --- GAME CONSTANTS ---
const ROAD_WIDTH = 24;
const SIDE_BARRIER_X = 10; 
const MAX_OBSTACLES = 40; 
const MAX_COINS = 60;
const MAX_LEADERBOARD_ENTRIES = 20;

interface CarModel {
  id: string;
  name: string;
  price: number;
  color: number;
  speedMult: number;
  handlingMult: number;
  unlocked: boolean;
}

interface LeaderboardEntry {
    name: string;
    score: number;
    car: string;
    date: number;
}

const CAR_CATALOG: CarModel[] = [
  { id: 'starter_red', name: 'Megatronix MK1', price: 0, color: 0xdc2626, speedMult: 1.0, handlingMult: 1.0, unlocked: true },
  { id: 'sedan_blue', name: 'MSIT Cruiser', price: 500, color: 0x2563eb, speedMult: 1.1, handlingMult: 0.9, unlocked: false },
  { id: 'sport_yellow', name: 'Cyber Hornet', price: 1500, color: 0xeab308, speedMult: 1.25, handlingMult: 1.1, unlocked: false },
  { id: 'super_black', name: 'Shadow V12', price: 5000, color: 0x111111, speedMult: 1.5, handlingMult: 1.3, unlocked: false }
];

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
  @ViewChild('landmarkCanvas') landmarkCanvas!: ElementRef<HTMLCanvasElement>;

  // --- REACTIVE STATE ---
  gameState = signal<'IDLE' | 'NAME_INPUT' | 'LOADING' | 'RUNNING' | 'SHOP' | 'GAME_OVER' | 'LEADERBOARD'>('IDLE');
  isPaused = signal(false);
  loadingMessage = signal('Booting AI Systems...');
  
  // Economy
  coins = signal(0);
  availableCars = signal<CarModel[]>(CAR_CATALOG);
  selectedCarId = signal<string>('starter_red');
  playerName = signal('');
  leaderboard = signal<LeaderboardEntry[]>([]);

  // HUD
  score = signal(0);
  speedKph = signal(0);
  currentGear = signal(1); 
  health = signal(100);
  
  // AI & Physics
  currentDriveState = signal<'NEUTRAL' | 'GAS' | 'BRAKING'>('NEUTRAL');
  virtualSteerAngle = signal(0); 
  isTwoHandMode = signal(false);
  aiSuggestion = signal('SYSTEM ONLINE');
  aiSuggestionType = signal<'INFO' | 'WARN' | 'DANGER'>('INFO');
  difficultyLevel = signal(1);

  // --- INTERNAL PHYSICS ---
  private speed = 0; 
  private carX = 0; 
  private carZ = 0; 
  private targetSteer = 0; 
  private currentSteer = 0; 
  
  // --- THREE.JS ---
  private scene: any;
  private camera: any;
  private renderer: any;
  private clock: any;
  
  // Objects
  private carGroup: any;
  private envGroup: any; 
  private obstacleGroup: any; 
  private coinGroup: any;
  private playerHeadlights: any; 
  private garageSpotlight: any; 
  private floatingSkyText: any;
  
  // Shared Assets
  private matRoad!: any;
  private matGrass!: any;
  private matRail!: any;
  private matBuilding!: any;
  private matTrafficBody!: any;
  
  private geoCoin!: any;
  private geoRock!: any;
  private geoWall!: any;
  private geoTrafficBody!: any;
  private geoTrafficLight!: any;
  private geoBuilding!: any;
  private geoTreeTrunk!: any;
  private geoTreeCrown!: any;
  
  private obstaclePool: any[] = [];
  private coinPool: any[] = [];
  
  // Atmosphere
  private fogColor!: any;
  private skyColor!: any;
  private sunLight!: any;
  
  // Audio
  private audioCtx: AudioContext | null = null;
  private engineOsc1: OscillatorNode | null = null; 
  private engineOsc2: OscillatorNode | null = null; 
  private engineGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  
  // --- LOOP & AI CONTROL ---
  private animId: number | null = null;
  private cvId: number | null = null;
  private lastCVTime = 0;
  private handLandmarker: any;
  private webcamRunning = false;
  private keydownListener: any;
  private resizeListener: any;
  
  // Preloading
  private cvLoadingPromise: Promise<void> | null = null;
  private aiReady = false;
  
  constructor() {
    this.loadSaveData();
  }

  ngAfterViewInit(): void {
    this.keydownListener = (e: KeyboardEvent) => {
        if (this.gameState() === 'RUNNING' && (e.key.toLowerCase() === 'p' || e.key === 'Escape')) {
            this.togglePause();
        }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', this.keydownListener);
        
        // Fix: Add resize listener to prevent visual glitches on screen change
        this.resizeListener = () => this.onWindowResize();
        window.addEventListener('resize', this.resizeListener);
    }
    
    // 1. Initialize 3D Engine immediately
    this.initThreeJS();

    // 2. Start Background AI Loading immediately
    this.preloadAI();
  }

  onWindowResize() {
      if (!this.camera || !this.renderer) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
  }

  // --- BACKGROUND LOADING SYSTEM ---
  async preloadAI() {
      if (this.cvLoadingPromise) return this.cvLoadingPromise;
      
      console.log("Starting Background AI Load...");
      this.cvLoadingPromise = (async () => {
          try {
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
             this.aiReady = true;
             console.log("AI Model Loaded & Ready");
          } catch(e) {
             console.error("AI Preload Failed:", e);
             this.cvLoadingPromise = null; 
          }
      })();
      return this.cvLoadingPromise;
  }

  async setupCamera() {
      if (this.webcamRunning) return;
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
          this.video.nativeElement.srcObject = stream;
          await new Promise(r => this.video.nativeElement.onloadeddata = r);
          this.webcamRunning = true;
      } catch(e) {
          console.error("Camera Access Failed", e);
          throw e;
      }
  }

  // --- DATA PERSISTENCE ---
  loadSaveData() {
      if (typeof localStorage === 'undefined') return;
      const save = localStorage.getItem('gesture_racer_v9_8');
      if (save) {
          try {
            const data = JSON.parse(save);
            this.coins.set(data.coins || 0);
            const updatedCatalog = CAR_CATALOG.map(c => {
                const saved = data.unlockedCars?.find((u: string) => u === c.id);
                if (saved) c.unlocked = true;
                return c;
            });
            this.availableCars.set(updatedCatalog);
            this.selectedCarId.set(data.selectedCar || 'starter_red');
          } catch(e) { console.warn("Save file corrupted, resetting."); }
      }
      const lb = localStorage.getItem('megatronix_leaderboard');
      if (lb) {
          try { this.leaderboard.set(JSON.parse(lb)); } catch(e) { this.leaderboard.set([]); }
      }
  }

  saveData() {
      if (typeof localStorage === 'undefined') return;
      const data = {
          coins: this.coins(),
          unlockedCars: this.availableCars().filter(c => c.unlocked).map(c => c.id),
          selectedCar: this.selectedCarId(),
      };
      localStorage.setItem('gesture_racer_v9_8', JSON.stringify(data));
  }
  
  updateLeaderboard(finalScore: number) {
      if(finalScore === 0) return;
      const entry: LeaderboardEntry = {
          name: this.playerName() || 'DRIVER',
          score: finalScore,
          car: this.availableCars().find(c => c.id === this.selectedCarId())?.name || 'Car',
          date: Date.now()
      };
      const current = [...this.leaderboard(), entry];
      current.sort((a, b) => b.score - a.score);
      const trimmed = current.slice(0, MAX_LEADERBOARD_ENTRIES);
      this.leaderboard.set(trimmed);
      if (typeof localStorage !== 'undefined') {
          localStorage.setItem('megatronix_leaderboard', JSON.stringify(trimmed));
      }
  }

  // --- MENU FLOW ---
  startNameEntry() {
      this.stopAllLoops();
      this.playerName.set(''); 
      this.gameState.set('NAME_INPUT');
      
      // Ensure scene is visible behind input
      this.initThreeJS();
      this.envGroup.visible = true;
      this.floatingSkyText.visible = true;
      this.scene.background = this.skyColor;
      this.camera.position.set(0, 4, 7);
      this.camera.lookAt(0, 0, -20);
      this.renderer.render(this.scene, this.camera);
  }

  submitName(name: string) {
      if(!name.trim()) return;
      this.playerName.set(name.trim().toUpperCase());
      this.initiateRaceSequence();
  }

  async initiateRaceSequence(): Promise<void> {
    this.gameState.set('LOADING');
    try {
      if (!this.audioCtx) await this.initAudio();
      
      // 1. Wait for AI 
      if (!this.aiReady) {
          this.loadingMessage.set('FINALIZING MEGATRONIX CORE...');
          await this.preloadAI();
      }
      
      // 2. Connect Camera
      if (!this.webcamRunning) {
          this.loadingMessage.set('CONNECTING VISION FEED...');
          await this.setupCamera();
      }
      
      this.initThreeJS();
      this.resetGame(); 
      this.startLoops();
      
    } catch (e) {
      console.error(e);
      this.loadingMessage.set('ERROR: SYSTEM FAILURE');
    }
  }
  
  startLoops() {
      this.stopAllLoops();
      this.animate(); 
      this.predictWebcam(); 
  }
  
  stopAllLoops() {
      if(this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
      if(this.cvId) { cancelAnimationFrame(this.cvId); this.cvId = null; }
  }

  resetGame(): void {
    this.score.set(0);
    this.speed = 0;
    this.carX = 0;
    this.carZ = 0;
    this.targetSteer = 0;
    this.currentSteer = 0;
    this.health.set(100);
    this.gameState.set('RUNNING');
    this.isPaused.set(false);
    this.difficultyLevel.set(1);
    this.aiSuggestionType.set('INFO');
    this.aiSuggestion.set('SYSTEM ONLINE');
    
    // Fix: Flush clock to prevent huge delta time spike
    this.clock.getDelta(); 

    this.resetPools();
    this.envGroup.clear();
    
    // Setup for Race Mode
    this.camera.position.set(0, 4, 7);
    this.camera.lookAt(0, 0, -20);
    this.carGroup.position.set(0, 0, 0);
    this.carGroup.rotation.set(0,0,0);
    
    this.skyColor.setHex(0x38bdf8);
    this.scene.background = this.skyColor;
    if(this.garageSpotlight) this.garageSpotlight.visible = false;
    this.envGroup.visible = true;
    this.obstacleGroup.visible = true;
    this.floatingSkyText.visible = true;
    
    this.createPlayerCar();
    for(let i=0; i<60; i++) this.spawnEnvironment();
    
    this.startAudio();
  }
  
  enterShop() {
      this.stopAllLoops();
      this.gameState.set('SHOP');
      this.createPlayerCar();
      
      this.camera.position.set(5, 3, 5);
      this.camera.lookAt(0, 0.5, 0);
      
      this.envGroup.visible = false;
      this.obstacleGroup.visible = false;
      this.coinGroup.visible = false;
      this.floatingSkyText.visible = false;
      
      this.scene.background = new THREE.Color(0x111827); 
      this.garageSpotlight.visible = true;
      this.playerHeadlights.visible = true; 
      
      this.animate(); 
  }
  
  returnToMenu() {
      this.stopAllLoops();
      this.stopAudio();
      this.gameState.set('IDLE');
      this.envGroup.visible = true; 
      this.floatingSkyText.visible = true;
      this.scene.background = this.skyColor;
      this.camera.position.set(0, 4, 7);
      this.camera.lookAt(0, 0, -20);
      this.renderer.render(this.scene, this.camera);
  }

  togglePause() {
      this.isPaused.update(p => !p);
      if(this.isPaused()) {
          this.audioCtx?.suspend();
          this.bgmAudio?.pause();
          this.clock.stop();
      } else {
          this.audioCtx?.resume();
          this.bgmAudio?.play();
          this.clock.start();
      }
  }

  buyCar(car: CarModel) {
      if (car.unlocked) {
          this.selectedCarId.set(car.id);
          this.saveData();
      } else if (this.coins() >= car.price) {
          this.coins.update(c => c - car.price);
          car.unlocked = true;
          this.availableCars.update(cars => [...cars]); 
          this.selectedCarId.set(car.id);
          this.saveData();
      }
      this.createPlayerCar();
  }

  // --- THREE.JS ENGINE ---
  initThreeJS(): void {
    if (this.scene) {
        // Ensure renderer is attached if component view was refreshed
        if (!this.canvasContainer.nativeElement.contains(this.renderer.domElement)) {
            this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);
        }
        return; 
    }

    const w = window.innerWidth;
    const h = window.innerHeight;

    this.scene = new THREE.Scene();
    this.skyColor = new THREE.Color(0x38bdf8); 
    this.fogColor = new THREE.Color(0x38bdf8);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.fogColor, 20, 250); 

    this.camera = new THREE.PerspectiveCamera(60, w/h, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Clear any existing children just in case
    this.canvasContainer.nativeElement.innerHTML = '';
    this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sunLight.position.set(50, 100, 50);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.scene.add(this.sunLight);
    
    this.garageSpotlight = new THREE.SpotLight(0xffffff, 2);
    this.garageSpotlight.position.set(0, 10, 0);
    this.garageSpotlight.angle = 0.5;
    this.garageSpotlight.penumbra = 0.5;
    this.garageSpotlight.castShadow = true;
    this.garageSpotlight.visible = false;
    this.scene.add(this.garageSpotlight);

    this.envGroup = new THREE.Group();
    this.obstacleGroup = new THREE.Group();
    this.coinGroup = new THREE.Group();
    this.carGroup = new THREE.Group();
    const staticGroup = new THREE.Group();
    
    this.scene.add(this.envGroup, this.obstacleGroup, this.coinGroup, this.carGroup, staticGroup);

    this.initSharedAssets();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), this.matGrass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    staticGroup.add(ground);

    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2000), this.matRoad);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    staticGroup.add(road);
    
    const lineGeo = new THREE.PlaneGeometry(0.5, 2000);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [-6, 6].forEach(x => {
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(x, 0.02, 0);
        line.rotation.x = -Math.PI/2;
        staticGroup.add(line);
    });

    const railGeo = new THREE.BoxGeometry(1, 1, 2000);
    const leftRail = new THREE.Mesh(railGeo, this.matRail);
    leftRail.position.set(-SIDE_BARRIER_X - 1, 0.5, 0);
    staticGroup.add(leftRail);

    const rightRail = new THREE.Mesh(railGeo, this.matRail);
    rightRail.position.set(SIDE_BARRIER_X + 1, 0.5, 0);
    staticGroup.add(rightRail);

    this.createSkyText();

    this.clock = new THREE.Clock();
    this.initPools();
  }

  createSkyText() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1024, 512);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 150, 255, 1)';
    ctx.shadowBlur = 10;
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    
    ctx.fillText("HUM JO JANTE HAI WO SIKHATE HAI", 512, 150);
    ctx.fillStyle = '#67e8f9'; 
    ctx.fillText("JO NAHI JANTE?", 512, 220);
    ctx.fillStyle = '#ffffff';
    ctx.fillText("WOH SIKHKE SIKHATE HAI!!!", 512, 290);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(100, 50);
    this.floatingSkyText = new THREE.Mesh(geometry, material);
    this.floatingSkyText.position.set(0, 30, -100);
    this.floatingSkyText.rotation.x = 0.1; 
    this.scene.add(this.floatingSkyText);
  }

  initSharedAssets() {
      this.matGrass = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 1.0 });
      this.matRoad = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 });
      this.matBuilding = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, flatShading: true });
      this.matTrafficBody = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.3, roughness: 0.5 });
      
      const cvs = document.createElement('canvas');
      cvs.width = 64; cvs.height = 64;
      const ctx = cvs.getContext('2d')!;
      ctx.fillStyle = '#ef4444'; 
      ctx.fillRect(0,0,64,64);
      ctx.fillStyle = '#ffffff'; 
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(32,0); ctx.lineTo(0,32); ctx.fill();
      ctx.beginPath(); ctx.moveTo(32,64); ctx.lineTo(64,64); ctx.lineTo(64,32); ctx.fill();
      const tex = new THREE.CanvasTexture(cvs);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 400);
      this.matRail = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });

      this.geoCoin = new THREE.CylinderGeometry(1, 1, 0.2, 16);
      this.geoRock = new THREE.DodecahedronGeometry(1.2);
      this.geoWall = new THREE.BoxGeometry(3, 2, 1);
      this.geoTrafficBody = new THREE.BoxGeometry(2, 1.2, 4);
      this.geoTrafficLight = new THREE.PlaneGeometry(0.5, 0.5);
      this.geoBuilding = new THREE.BoxGeometry(4, 1, 4); 
      this.geoTreeTrunk = new THREE.CylinderGeometry(0.2, 0.4, 3, 6);
      this.geoTreeCrown = new THREE.DodecahedronGeometry(1.5);
  }

  initPools() {
      for(let i=0; i<MAX_OBSTACLES; i++) {
          const group = new THREE.Group();
          group.visible = false;
          this.obstaclePool.push({ active: false, mesh: group, type: 'NONE', laneChangeTimer: 0, speedOffset: 0, targetX: 0 });
          this.obstacleGroup.add(group);
      }
      for(let i=0; i<MAX_COINS; i++) {
          const mesh = new THREE.Mesh(this.geoCoin, new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 1, emissive: 0xFFAA00, emissiveIntensity: 0.4 }));
          mesh.rotation.x = Math.PI/2;
          mesh.visible = false;
          this.coinPool.push({ active: false, mesh: mesh });
          this.coinGroup.add(mesh);
      }
  }

  resetPools() {
      this.obstaclePool.forEach(o => { o.active = false; o.mesh.visible = false; o.mesh.clear(); });
      this.coinPool.forEach(c => { c.active = false; c.mesh.visible = false; });
  }

  spawnEnvironment() {
      const group = new THREE.Group();
      const zPos = -(Math.random() * 600); 
      const side = Math.random() > 0.5 ? 1 : -1;
      const xPos = side * (18 + Math.random() * 40); 
      
      group.position.set(xPos, 0, zPos);
      
      const type = Math.random();
      if(type < 0.7) {
          const trunk = new THREE.Mesh(this.geoTreeTrunk, new THREE.MeshStandardMaterial({ color: 0x4a3728 }));
          trunk.position.y = 1.5;
          trunk.castShadow = true;
          group.add(trunk);
          
          const crown = new THREE.Mesh(this.geoTreeCrown, new THREE.MeshStandardMaterial({ color: 0x15803d }));
          crown.position.y = 3.5;
          crown.rotation.y = Math.random() * Math.PI;
          crown.castShadow = true;
          group.add(crown);
      } else {
          const height = 5 + Math.random() * 15;
          const bldgGeo = new THREE.BoxGeometry(5, height, 5);
          const bldg = new THREE.Mesh(bldgGeo, this.matBuilding);
          bldg.position.y = height / 2;
          bldg.castShadow = true;
          group.add(bldg);
      }
      
      this.envGroup.add(group);
  }

  // --- RENDER LOOP (60FPS) ---
  animate() {
      if (this.isPaused()) return;
      if (!['RUNNING', 'SHOP'].includes(this.gameState())) return;

      const dt = this.clock.getDelta();
      
      // SHOP MODE
      if (this.gameState() === 'SHOP') {
          this.carGroup.rotation.y += 0.5 * dt;
          this.carGroup.position.y = Math.sin(Date.now() * 0.002) * 0.1;
          this.renderer.render(this.scene, this.camera);
          this.animId = requestAnimationFrame(() => this.animate());
          return;
      }

      // GAME MODE
      const currentCar = this.availableCars().find(c => c.id === this.selectedCarId()) || CAR_CATALOG[0];

      this.updateAtmosphere(dt);

      const currentScore = this.score();
      const difficulty = 1 + Math.floor(currentScore / 2000) * 0.2;
      this.difficultyLevel.set(Math.floor(difficulty) + 1);

      const maxSpeed = 5.5 * currentCar.speedMult * (1 + (difficulty * 0.05));
      const currentKph = this.speed * 60;
      
      if (this.currentDriveState() === 'GAS') {
          let accelRate = 0.2; 
          if (currentKph > 60) accelRate = 0.33; 
          if (currentKph > 120) accelRate = 0.33; 
          if (currentKph > 180) accelRate = 0.25; 
          this.speed += accelRate * dt; 
          if(this.speed > maxSpeed) this.speed = maxSpeed;
      } else if (this.currentDriveState() === 'BRAKING') {
          this.speed -= 12.0 * dt; 
          if(this.speed < 0) this.speed = 0;
      } else {
          this.speed -= 1.0 * dt; 
          if(this.speed < 0) this.speed = 0;
      }

      this.currentSteer += (this.targetSteer - this.currentSteer) * LERP_FACTOR;
      
      const speedFactor = Math.max(0.5, this.speed / maxSpeed); 
      const handling = 14.0 * currentCar.handlingMult * speedFactor;
      const turnAmount = this.currentSteer * handling * dt;
      this.carX += turnAmount;
      
      const barrierLimit = SIDE_BARRIER_X - 1.5;
      if (this.carX > barrierLimit || this.carX < -barrierLimit) {
          this.health.update(h => Math.max(0, h - (60 * dt)));
          this.speed *= 0.95; 
          this.aiSuggestion.set('BARRIER WARNING');
          this.aiSuggestionType.set('DANGER');
          this.carGroup.position.x = this.carX + (Math.random() * 0.3 - 0.15); 
          if (this.health() <= 0) this.crash(true);
      } else {
          this.carGroup.position.x = this.carX;
      }
      
      this.carGroup.rotation.z = -this.currentSteer * 0.35; 
      this.carGroup.rotation.y = -this.currentSteer * 0.15;

      const kph = Math.floor(this.speed * 60);
      this.speedKph.set(kph);
      this.updateGearAudio(kph);

      const moveZ = this.speed * 40 * dt;
      this.score.update(s => s + Math.floor(moveZ / 2));
      this.carZ += moveZ; 

      this.envGroup.children.forEach((obj: any) => {
          obj.position.z += moveZ;
          if(obj.position.z > 50) {
              obj.position.z -= 600; 
              const side = Math.random() > 0.5 ? 1 : -1;
              obj.position.x = side * (15 + Math.random() * 40);
          }
      });

      this.updateEntities(dt, moveZ, difficulty);
      this.renderer.render(this.scene, this.camera);
      this.animId = requestAnimationFrame(() => this.animate());
  }

  // --- COMPUTER VISION LOOP (Throttled to ~30FPS) ---
  async predictWebcam() {
      if(this.gameState() !== 'RUNNING') return;

      const now = performance.now();
      if (now - this.lastCVTime >= CV_THROTTLE_MS) {
          this.lastCVTime = now;
          if(this.handLandmarker && this.webcamRunning) {
              const results = this.handLandmarker.detectForVideo(this.video.nativeElement, now);
              if(results.landmarks) {
                  this.processHands(results.landmarks);
                  this.drawLandmarks(results.landmarks);
              }
          }
      }
      
      this.cvId = requestAnimationFrame(() => this.predictWebcam());
  }

  processHands(landmarks: any[][]) {
      let steerInput = 0; 
      let driveState: 'GAS' | 'BRAKING' | 'NEUTRAL' = 'NEUTRAL';
      
      if(landmarks.length === 0) {
          this.isTwoHandMode.set(false);
          driveState = 'NEUTRAL'; 
      } else if (landmarks.length === 1) {
          this.isTwoHandMode.set(false);
          const hand = landmarks[0];
          const wrist = hand[0];
          const middleKnuckle = hand[9]; 
          
          const dx = middleKnuckle.x - wrist.x;
          if (Math.abs(dx) < 0.03) steerInput = 0; 
          else steerInput = dx * -8.0; 
          
          const tips = [hand[8], hand[12], hand[16], hand[20]];
          const avgDist = tips.reduce((s, t) => s + Math.hypot(t.x - wrist.x, t.y - wrist.y), 0) / 4;
          
          if (avgDist < 0.25) driveState = 'BRAKING'; 
          else if (avgDist > 0.35) driveState = 'GAS'; 

      } else if (landmarks.length === 2) {
          this.isTwoHandMode.set(true);
          const h1 = landmarks[0][9];
          const h2 = landmarks[1][9];
          const left = h1.x < h2.x ? h1 : h2;
          const right = h1.x < h2.x ? h2 : h1;
          
          const dy = right.y - left.y;
          const dx = right.x - left.x;
          const angle = Math.atan2(dy, dx); 
          steerInput = angle * -3.0; 
          this.virtualSteerAngle.set(angle * (180/Math.PI)); 
          driveState = 'GAS'; 
      }
      
      steerInput = Math.max(-1, Math.min(1, steerInput));
      const sign = Math.sign(steerInput);
      steerInput = sign * Math.pow(Math.abs(steerInput), 1.5); 
      
      this.targetSteer = this.targetSteer * 0.7 + steerInput * 0.3;
      
      this.currentDriveState.set(driveState);
  }

  drawLandmarks(landmarks: any[][]) {
      const canvas = this.landmarkCanvas.nativeElement;
      const ctx = canvas.getContext('2d');
      if(!ctx) return;
      canvas.width = this.video.nativeElement.videoWidth;
      canvas.height = this.video.nativeElement.videoHeight;
      ctx.clearRect(0,0, canvas.width, canvas.height);
      
      for(const hand of landmarks) {
          const state = this.currentDriveState();
          ctx.fillStyle = state === 'BRAKING' ? '#ef4444' : (state === 'GAS' ? '#22c55e' : '#facc15');
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 2;

          const connections = [[0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8], [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16], [13,17],[17,18],[18,19],[19,20], [0,17]];
          for(const [i,j] of connections) {
              const p1 = hand[i];
              const p2 = hand[j];
              ctx.beginPath(); 
              ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
              ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height); 
              ctx.stroke();
          }

          for(const point of hand) {
              ctx.beginPath();
              ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, 2 * Math.PI);
              ctx.fill();
          }
      }
      
      if(landmarks.length === 2 && this.isTwoHandMode()) {
          const h1 = landmarks[0][9]; const h2 = landmarks[1][9];
          const cx = ((h1.x + h2.x) / 2) * canvas.width; const cy = ((h1.y + h2.y) / 2) * canvas.height;
          const radius = Math.max(40, Math.sqrt(Math.pow((h1.x - h2.x)*canvas.width, 2) + Math.pow((h1.y - h2.y)*canvas.height, 2)) / 2.2);
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.virtualSteerAngle() * (Math.PI / 180)); 
          ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 6;
          ctx.arc(0, 0, radius, 0, 2 * Math.PI); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0); ctx.stroke(); ctx.restore();
      }
  }

  // --- ENTITY UPDATES ---
  updateAtmosphere(dt: number) {
      const time = Date.now() * 0.00005; 
      const cycle = (Math.sin(time) + 1) / 2; 

      let r, g, b;
      if(cycle < 0.2) { 
          r=0.05; g=0.05; b=0.1; 
          this.playerHeadlights.visible = true; 
      } else if (cycle < 0.4) {
          const t = (cycle - 0.2) * 5; 
          r = THREE.MathUtils.lerp(0.05, 0.22, t);
          g = THREE.MathUtils.lerp(0.05, 0.74, t);
          b = THREE.MathUtils.lerp(0.1, 0.98, t);
          this.playerHeadlights.visible = true;
      } else {
          const t = (cycle - 0.4) * 2; 
          r = THREE.MathUtils.lerp(0.22, 0.5, t); 
          g = THREE.MathUtils.lerp(0.74, 0.8, t);
          b = THREE.MathUtils.lerp(0.98, 1.0, t);
          this.playerHeadlights.visible = false;
      }
      this.skyColor.setRGB(r, g, b);
      this.fogColor.copy(this.skyColor);
      this.scene.background = this.skyColor;
      this.scene.fog.color = this.fogColor;
      this.sunLight.position.x = Math.cos(time) * 100;
      this.sunLight.position.y = Math.sin(time) * 100;
      this.sunLight.intensity = Math.max(0.1, cycle * 1.5);
      const groundBrightness = Math.max(0.1, cycle);
      this.matGrass.color.setHSL(0.4, 0.6, groundBrightness * 0.6); 
  }

  updateEntities(dt: number, moveZ: number, difficulty: number) {
      const spawnChance = 0.01 + (difficulty * 0.008); 
      if (Math.random() < spawnChance) this.spawnObstacleFromPool();
      if (Math.floor(this.carZ) % 800 < 50 && Math.random() < 0.15) this.spawnCoinPattern();

      this.obstaclePool.forEach(poolObj => {
          if(!poolObj.active) return;
          let relSpeed = this.speed * 40;
          const obs = poolObj.mesh;
          if (poolObj.type === 'TRAFFIC') {
              relSpeed += 20 + poolObj.speedOffset;
              poolObj.laneChangeTimer -= dt;
              if (poolObj.laneChangeTimer <= 0) {
                  poolObj.targetX = (Math.floor(Math.random() * 5) - 2) * 4;
                  poolObj.laneChangeTimer = (2 + Math.random() * 3) / (difficulty * 0.5); 
              }
              obs.position.x += (poolObj.targetX - obs.position.x) * 3 * dt;
          }
          obs.position.z += relSpeed * dt;
          const hitDistZ = 2.5; const hitDistX = poolObj.width || 2.0;
          if (Math.abs(obs.position.z) < hitDistZ && Math.abs(obs.position.x - this.carX) < hitDistX) {
              this.crash();
              poolObj.active = false; obs.visible = false;
          }
          if (obs.position.z > 50) { poolObj.active = false; obs.visible = false; }
      });

      this.coinPool.forEach(poolCoin => {
          if(!poolCoin.active) return;
          const c = poolCoin.mesh;
          c.position.z += moveZ; c.rotation.y += 5 * dt; 
          if (Math.abs(c.position.z) < 2 && Math.abs(c.position.x - this.carX) < 2.5) {
              this.coins.update(v => v + 10);
              this.aiSuggestion.set('+10 CREDITS');
              poolCoin.active = false; c.visible = false;
          }
          if (c.position.z > 20) { poolCoin.active = false; c.visible = false; }
      });
  }

  spawnObstacleFromPool() {
      const poolObj = this.obstaclePool.find(o => !o.active);
      if(!poolObj) return; 
      const lane = (Math.floor(Math.random() * 5) - 2) * 4;
      const zPos = -400 - Math.random() * 100;
      poolObj.active = true; poolObj.mesh.visible = true; poolObj.mesh.clear(); 
      poolObj.mesh.position.set(lane, 0, zPos);
      poolObj.targetX = lane; poolObj.laneChangeTimer = 1 + Math.random(); poolObj.speedOffset = Math.random() * 10;
      
      const typeRoll = Math.random();
      let type = 'ROCK'; let width = 1.5;

      if (typeRoll < 0.4) {
          type = 'TRAFFIC';
          const body = new THREE.Mesh(this.geoTrafficBody, this.matTrafficBody);
          body.position.y = 0.6; body.castShadow = true; poolObj.mesh.add(body);
          const light = new THREE.Mesh(this.geoTrafficLight, new THREE.MeshBasicMaterial({color: 0xffffff}));
          light.position.set(-0.5, 0.6, 2.01); poolObj.mesh.add(light);
          const light2 = light.clone(); light2.position.set(0.5, 0.6, 2.01); poolObj.mesh.add(light2);
      } else if (typeRoll < 0.7) {
          type = 'WALL'; width = 2.5;
          const wall = new THREE.Mesh(this.geoWall, new THREE.MeshStandardMaterial({ color: 0x64748b }));
          wall.position.y = 1; wall.castShadow = true; poolObj.mesh.add(wall);
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.5, 1.1), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
          stripe.position.y = 1; poolObj.mesh.add(stripe);
      } else {
          type = 'ROCK';
          const rock = new THREE.Mesh(this.geoRock, new THREE.MeshStandardMaterial({ color: 0x475569 }));
          rock.position.y = 0.6; rock.castShadow = true; poolObj.mesh.add(rock);
      }
      poolObj.type = type; poolObj.width = width;
  }

  spawnCoinPattern() {
      const lane = (Math.floor(Math.random() * 5) - 2) * 4;
      const isZigZag = this.difficultyLevel() > 3 && Math.random() > 0.5;
      for(let i=0; i<5; i++) {
          const coin = this.coinPool.find(c => !c.active);
          if(coin) {
              coin.active = true; coin.mesh.visible = true;
              const xOffset = isZigZag ? Math.sin(i)*2 : 0;
              coin.mesh.position.set(lane + xOffset, 1.5, -400 - (i * 15));
          }
      }
  }

  createPlayerCar() {
      this.carGroup.clear();
      const currentCar = this.availableCars().find(c => c.id === this.selectedCarId()) || CAR_CATALOG[0];
      const bodyMat = new THREE.MeshStandardMaterial({ color: currentCar.color, metalness: 0.8, roughness: 0.2, emissive: currentCar.color, emissiveIntensity: 0.1 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1.0, roughness: 0.0, transparent: true, opacity: 0.9 });
      
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.4), bodyMat);
      chassis.position.y = 0.6; chassis.castShadow = true; this.carGroup.add(chassis);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.4), glassMat);
      cabin.position.set(0, 1.2, -0.3); this.carGroup.add(cabin);
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.5), bodyMat);
      spoiler.position.set(0, 1.1, 1.8); this.carGroup.add(spoiler);

      this.playerHeadlights = new THREE.Group();
      const leftLight = new THREE.SpotLight(0xffffff, 2);
      leftLight.position.set(-0.8, 0.8, -2); leftLight.target.position.set(-0.8, 0, -20);
      leftLight.angle = 0.5; leftLight.penumbra = 0.3; leftLight.distance = 100; leftLight.castShadow = true;
      this.playerHeadlights.add(leftLight); this.playerHeadlights.add(leftLight.target);
      const rightLight = leftLight.clone();
      rightLight.position.set(0.8, 0.8, -2); rightLight.target.position.set(0.8, 0, -20);
      this.playerHeadlights.add(rightLight); this.playerHeadlights.add(rightLight.target);
      this.playerHeadlights.visible = false; this.carGroup.add(this.playerHeadlights);

      const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.6, 16);
      wheelGeo.rotateZ(Math.PI/2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      [ {x:1.2, z:1.4}, {x:-1.2, z:1.4}, {x:1.2, z:-1.4}, {x:-1.2, z:-1.4} ].forEach(p => {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(p.x, 0.45, p.z); w.castShadow = true; this.carGroup.add(w);
      });
  }

  updateGearAudio(kph: number) {
      let g = 1;
      if (kph > 180) g = 5; else if (kph > 140) g = 4; else if (kph > 120) g = 3; else if (kph > 60) g = 2; 
      this.currentGear.set(g);
      if (this.engineOsc1 && this.engineOsc2 && this.audioCtx) {
          const minSpeedForGear = (g - 1) * 45;
          const rpmNorm = Math.min(1, Math.max(0, (kph - minSpeedForGear) / 50));
          const base1 = 60 + (g * 25); const base2 = 62 + (g * 25); 
          this.engineOsc1.frequency.setTargetAtTime(base1 + (rpmNorm * 100), this.audioCtx.currentTime, 0.1);
          this.engineOsc2.frequency.setTargetAtTime(base2 + (rpmNorm * 105), this.audioCtx.currentTime, 0.1);
          this.engineGain!.gain.setTargetAtTime(0.1 + (rpmNorm * 0.1), this.audioCtx.currentTime, 0.1);
      }
  }

  crash(fatal = false) {
      if (fatal) this.health.set(0); else this.health.update(h => Math.max(0, h - 34));
      this.speed *= 0.2; this.currentSteer = 0; this.targetSteer = 0;
      this.aiSuggestion.set('CRITICAL DAMAGE'); this.aiSuggestionType.set('DANGER');
      if(this.health() <= 0) {
          this.stopAllLoops();
          this.gameState.set('GAME_OVER');
          this.updateLeaderboard(this.score());
          this.saveData();
          this.stopAudio();
      }
  }

  async setupCV() {
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      this.video.nativeElement.srcObject = stream;
      await new Promise(r => this.video.nativeElement.onloadeddata = r);
      this.webcamRunning = true;
  }

  async initAudio() {
      if(typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.bgmAudio = new Audio(BGM_URL);
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = 0.3; 
      this.bgmAudio.crossOrigin = 'anonymous';
  }
  
  startAudio() {
      if(!this.audioCtx) return;
      if(this.audioCtx.state === 'suspended') this.audioCtx.resume();
      this.bgmAudio?.play().catch(() => {});
      this.engineOsc1 = this.audioCtx.createOscillator(); this.engineOsc1.type = 'sawtooth';
      this.engineOsc2 = this.audioCtx.createOscillator(); this.engineOsc2.type = 'sawtooth';
      this.engineGain = this.audioCtx.createGain(); this.engineGain.gain.value = 0.1; 
      const filter = this.audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
      this.engineOsc1.connect(filter); this.engineOsc2.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.audioCtx.destination);
      this.engineOsc1.start(); this.engineOsc2.start();
  }
  
  stopAudio() {
      if(this.engineOsc1) {
          try { this.engineOsc1.stop(); this.engineOsc2?.stop(); } catch(e){}
          this.engineOsc1 = null; this.engineOsc2 = null;
      }
      this.bgmAudio?.pause();
  }

  ngOnDestroy() {
      this.stopAllLoops();
      this.stopAudio(); 
      this.audioCtx?.close();
      if(this.video && this.video.nativeElement.srcObject) {
          const stream = this.video.nativeElement.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }
      if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', this.keydownListener);
          window.removeEventListener('resize', this.resizeListener);
      }
  }
}
