
/*
 * PROJECT: Gesture Racer 3D (Megatronix Edition)
 * AUTHOR: Soumoditya Das & Team Megatronix 2026 (MSIT)
 * VERSION: 7.0.1 (Stable Build)
 */

import { Component, ChangeDetectionStrategy, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

// Access THREE from global scope
declare const THREE: any;

// --- CONFIG ---
const BGM_URL = 'https://opengameart.org/sites/default/files/Rolemusic_-_pl4y1ng.mp3'; 
const LERP_FACTOR = 0.08; // Optimized for smooth demo

interface CarModel {
  id: string;
  name: string;
  price: number;
  color: number;
  speedMult: number;
  handlingMult: number;
  unlocked: boolean;
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

  // --- STATE ---
  gameState = signal<'IDLE' | 'LOADING' | 'RUNNING' | 'SHOP' | 'GAME_OVER'>('IDLE');
  isPaused = signal(false);
  loadingMessage = signal('Booting AI Systems...');
  
  // Economy
  coins = signal(0);
  availableCars = signal<CarModel[]>(CAR_CATALOG);
  selectedCarId = signal<string>('starter_red');

  // Gameplay UI Signals
  score = signal(0);
  speedKph = signal(0);
  currentGear = signal(1); 
  
  // Physics & Vision Signals
  currentDriveState = signal<'NEUTRAL' | 'GAS' | 'BRAKING'>('NEUTRAL');
  virtualSteerAngle = signal(0); 
  isTwoHandMode = signal(false);
  aiSuggestion = signal('SYSTEM ONLINE');
  aiSuggestionType = signal<'INFO' | 'WARN' | 'DANGER'>('INFO');

  // Internal Physics
  private speed = 0; 
  private maxSpeedBase = 5.0; 
  private carX = 0; 
  
  // Smoothing
  private targetSteer = 0; 
  private currentSteer = 0; 
  private carHealth = 100;
  
  // Three.js
  private scene: any;
  private camera: any;
  private renderer: any;
  private clock: any;
  private carGroup: any;
  private envGroup: any; 
  private obstacleGroup: any; 
  private coinGroup: any;
  
  // Audio
  private audioCtx: AudioContext | null = null;
  private engineOsc1: OscillatorNode | null = null; 
  private engineOsc2: OscillatorNode | null = null; 
  private engineGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  
  // Loops
  private animId: number | null = null;
  private cvId: number | null = null;
  private handLandmarker: any;
  private webcamRunning = false;
  private keydownListener: any;

  constructor() {
    this.loadSaveData();
  }

  ngAfterViewInit(): void {
    this.keydownListener = (e: KeyboardEvent) => {
        if (this.gameState() === 'RUNNING' && (e.key.toLowerCase() === 'p' || e.key === 'Escape')) {
            this.togglePause();
        }
    };
    window.addEventListener('keydown', this.keydownListener);
  }

  loadSaveData() {
      const save = localStorage.getItem('gesture_racer_v7');
      if (save) {
          const data = JSON.parse(save);
          this.coins.set(data.coins || 0);
          
          const updatedCatalog = CAR_CATALOG.map(c => {
              const saved = data.unlockedCars?.find((u: string) => u === c.id);
              if (saved) c.unlocked = true;
              return c;
          });
          this.availableCars.set(updatedCatalog);
          this.selectedCarId.set(data.selectedCar || 'starter_red');
      }
  }

  saveData() {
      const data = {
          coins: this.coins(),
          unlockedCars: this.availableCars().filter(c => c.unlocked).map(c => c.id),
          selectedCar: this.selectedCarId()
      };
      localStorage.setItem('gesture_racer_v7', JSON.stringify(data));
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
  }

  async startGame(): Promise<void> {
    this.gameState.set('LOADING');
    try {
      if (!this.audioCtx) await this.initAudio();
      
      if (!this.handLandmarker) {
          this.loadingMessage.set('Calibrating AI Vision...');
          await this.setupCV();
      }
      
      this.initThreeJS();
      this.resetGame();
      
      if (!this.cvId) this.predictWebcam();
      
    } catch (e) {
      console.error(e);
      // More descriptive error message
      if (e instanceof Error && e.message.includes('fetch')) {
         this.loadingMessage.set('Network Error: Check Connection');
      } else {
         this.loadingMessage.set('Error: Camera Access Denied');
      }
    }
  }

  resetGame(): void {
    this.score.set(0);
    this.speed = 0;
    this.carX = 0;
    this.targetSteer = 0;
    this.currentSteer = 0;
    this.carHealth = 100;
    this.gameState.set('RUNNING');
    this.isPaused.set(false);
    
    this.obstacleGroup.clear();
    this.coinGroup.clear();
    this.envGroup.clear();
    
    this.createPlayerCar();
    for(let i=0; i<80; i++) this.spawnTree();
    
    this.startAudio();
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animate();
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
          this.animate();
      }
  }

  // --- THREE.JS SCENE ---
  initThreeJS(): void {
    if (this.scene) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); 
    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 500);

    this.camera = new THREE.PerspectiveCamera(60, w/h, 0.1, 1000);
    this.camera.position.set(0, 4, 7);
    this.camera.lookAt(0, 0, -20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.8);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(50, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);

    this.envGroup = new THREE.Group();
    this.obstacleGroup = new THREE.Group();
    this.coinGroup = new THREE.Group();
    this.carGroup = new THREE.Group();
    
    this.scene.add(this.envGroup, this.obstacleGroup, this.coinGroup, this.carGroup);

    // Ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(2000, 2000),
        new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Road
    const road = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 2000),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 })
    );
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    this.scene.add(road);
    
    // Lane Markings
    const lineGeo = new THREE.PlaneGeometry(0.5, 2000);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineLeft = new THREE.Mesh(lineGeo, lineMat);
    lineLeft.position.set(-6, 0.01, 0);
    lineLeft.rotation.x = -Math.PI/2;
    
    const lineRight = new THREE.Mesh(lineGeo, lineMat);
    lineRight.position.set(6, 0.01, 0);
    lineRight.rotation.x = -Math.PI/2;
    this.scene.add(lineLeft, lineRight);

    this.clock = new THREE.Clock();
  }

  createPlayerCar() {
      this.carGroup.clear();
      const currentCar = this.availableCars().find(c => c.id === this.selectedCarId()) || CAR_CATALOG[0];
      
      const bodyMat = new THREE.MeshStandardMaterial({ color: currentCar.color, metalness: 0.6, roughness: 0.2 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.1 });
      
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4.2), bodyMat);
      chassis.position.y = 0.6;
      chassis.castShadow = true;
      this.carGroup.add(chassis);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), glassMat);
      cabin.position.set(0, 1.1, -0.2);
      this.carGroup.add(cabin);

      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16);
      wheelGeo.rotateZ(Math.PI/2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      
      [ {x:1.1, z:1.3}, {x:-1.1, z:1.3}, {x:1.1, z:-1.3}, {x:-1.1, z:-1.3} ].forEach(p => {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.position.set(p.x, 0.4, p.z);
          w.castShadow = true;
          this.carGroup.add(w);
      });
  }

  spawnTree() {
      const tree = new THREE.Group();
      
      const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.6, 2, 8), 
          new THREE.MeshStandardMaterial({color: 0x78350f})
      );
      trunk.position.y = 1;
      trunk.castShadow = true;
      
      const leaves = new THREE.Mesh(
          new THREE.ConeGeometry(2, 5, 8),
          new THREE.MeshStandardMaterial({color: 0x15803d})
      );
      leaves.position.y = 4;
      leaves.castShadow = true;
      
      tree.add(trunk, leaves);
      
      const x = (Math.random() > 0.5 ? 1 : -1) * (16 + Math.random() * 60);
      const z = (Math.random() * 1000) - 500;
      tree.position.set(x, 0, z);
      
      const s = 0.8 + Math.random() * 0.5;
      tree.scale.set(s,s,s);
      
      this.envGroup.add(tree);
  }

  // --- MAIN LOOP ---
  animate() {
      if (this.isPaused() || this.gameState() !== 'RUNNING') return;

      const dt = this.clock.getDelta();
      const currentCar = this.availableCars().find(c => c.id === this.selectedCarId()) || CAR_CATALOG[0];

      // 1. Acceleration Physics
      const maxSpeed = this.maxSpeedBase * currentCar.speedMult;
      
      if (this.currentDriveState() === 'GAS') {
          this.speed += 3.0 * dt; 
          if(this.speed > maxSpeed) this.speed = maxSpeed;
      } else if (this.currentDriveState() === 'BRAKING') {
          this.speed -= 6.0 * dt; 
          if(this.speed < 0) this.speed = 0;
      } else {
          this.speed -= 1.0 * dt; 
          if(this.speed < 0) this.speed = 0;
      }

      // 2. Steering Physics (LERP SMOOTHING)
      this.currentSteer += (this.targetSteer - this.currentSteer) * LERP_FACTOR;
      
      const handling = 12.0 * currentCar.handlingMult;
      const turnAmount = this.currentSteer * handling * dt;
      
      this.carX += turnAmount;
      this.carX = Math.max(-10, Math.min(10, this.carX)); 
      
      this.carGroup.position.x = this.carX;
      this.carGroup.rotation.z = -this.currentSteer * 0.4; 
      this.carGroup.rotation.y = -this.currentSteer * 0.2;

      // 3. Stats & Audio
      const kph = Math.floor(this.speed * 60);
      this.speedKph.set(kph);
      
      let g = 1;
      if (kph > 160) g = 5;
      else if (kph > 120) g = 4;
      else if (kph > 80) g = 3;
      else if (kph > 40) g = 2;
      this.currentGear.set(g);

      // Audio Engine Logic
      if (this.engineOsc1 && this.engineOsc2 && this.audioCtx) {
          const minSpeedForGear = (g - 1) * 40;
          const range = 40;
          const rpmNorm = Math.min(1, Math.max(0, (kph - minSpeedForGear) / range));
          
          const base1 = 60 + (g * 20); 
          const base2 = 62 + (g * 20); 
          
          const targetFreq1 = base1 + (rpmNorm * 80);
          const targetFreq2 = base2 + (rpmNorm * 85);

          this.engineOsc1.frequency.setTargetAtTime(targetFreq1, this.audioCtx.currentTime, 0.1);
          this.engineOsc2.frequency.setTargetAtTime(targetFreq2, this.audioCtx.currentTime, 0.1);
          
          const idleWobble = (kph < 5) ? 0.05 * Math.sin(this.audioCtx.currentTime * 10) : 0;
          this.engineGain!.gain.setTargetAtTime(0.15 + (rpmNorm * 0.1) + idleWobble, this.audioCtx.currentTime, 0.1);
      }

      // 4. Move World
      const moveZ = this.speed * 40 * dt;
      this.score.update(s => s + Math.floor(moveZ));
      
      this.envGroup.children.forEach((obj: any) => {
          obj.position.z += moveZ;
          if(obj.position.z > 50) {
              obj.position.z -= 1000;
              obj.position.x = (Math.random() > 0.5 ? 1 : -1) * (16 + Math.random() * 60);
          }
      });

      this.updateObstacles(dt, moveZ);
      this.renderer.render(this.scene, this.camera);
      this.animId = requestAnimationFrame(() => this.animate());
  }

  updateObstacles(dt: number, moveZ: number) {
      if (Math.random() < 0.015) this.spawnTraffic();
      if (Math.random() < 0.01) this.spawnCoin();

      const toRemove: any[] = [];
      this.obstacleGroup.children.forEach((obs: any) => {
          const trafficSpeed = obs.userData.isOncoming ? 30 : 20; 
          const relSpeed = (this.speed * 40) - (obs.userData.isOncoming ? -trafficSpeed : trafficSpeed);
          
          obs.position.z += relSpeed * dt;
          
          // Collision
          if (Math.abs(obs.position.z) < 3.5 && Math.abs(obs.position.x - this.carX) < 2.0) {
              this.crash();
          }
          if (obs.position.z > 50) toRemove.push(obs);
      });
      toRemove.forEach(o => this.obstacleGroup.remove(o));

      const coinsRem: any[] = [];
      this.coinGroup.children.forEach((c: any) => {
          c.position.z += moveZ;
          c.rotation.y += 3 * dt;
          
          if (Math.abs(c.position.z) < 2 && Math.abs(c.position.x - this.carX) < 2) {
              this.coins.update(v => v + 50);
              this.aiSuggestion.set('+50 CREDITS');
              coinsRem.push(c);
          }
          if (c.position.z > 20) coinsRem.push(c);
      });
      coinsRem.forEach(c => this.coinGroup.remove(c));
  }

  spawnTraffic() {
      const lane = [-6, -2, 2, 6][Math.floor(Math.random()*4)];
      const car = new THREE.Mesh(
          new THREE.BoxGeometry(2, 1, 4),
          new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff })
      );
      car.position.set(lane, 0.5, -400);
      car.castShadow = true;
      car.userData = { isOncoming: lane < 0 };
      this.obstacleGroup.add(car);
  }

  spawnCoin() {
      const lane = [-6, -2, 2, 6][Math.floor(Math.random()*4)];
      const coin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.8, 0.8, 0.2, 16),
          new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 1, emissive: 0xFFD700, emissiveIntensity: 0.2 })
      );
      coin.rotation.x = Math.PI/2;
      coin.position.set(lane, 1, -400);
      this.coinGroup.add(coin);
  }

  crash() {
      this.carHealth -= 50;
      this.speed = 0;
      this.currentSteer = 0; 
      this.targetSteer = 0;
      this.aiSuggestion.set('CRITICAL DAMAGE');
      this.aiSuggestionType.set('DANGER');
      
      if(this.carHealth <= 0) {
          this.gameState.set('GAME_OVER');
          this.saveData();
          this.stopAudio();
      } else {
          this.carX = -this.carX / 2;
      }
  }

  // --- COMPUTER VISION ---
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

  async predictWebcam() {
      if(this.handLandmarker && this.webcamRunning) {
          const results = this.handLandmarker.detectForVideo(this.video.nativeElement, performance.now());
          if(results.landmarks) {
              this.processHands(results.landmarks);
              this.drawLandmarks(results.landmarks);
          } else {
              // Safety: If hand lost, brakes on
              if(this.currentDriveState() !== 'NEUTRAL') {
                  this.currentDriveState.set('BRAKING');
              }
          }
      }
      this.cvId = requestAnimationFrame(() => this.predictWebcam());
  }

  drawLandmarks(landmarks: any[][]) {
      const canvas = this.landmarkCanvas.nativeElement;
      const ctx = canvas.getContext('2d');
      if(!ctx) return;
      
      canvas.width = this.video.nativeElement.videoWidth;
      canvas.height = this.video.nativeElement.videoHeight;
      ctx.clearRect(0,0, canvas.width, canvas.height);
      
      for(const hand of landmarks) {
          const wrist = hand[0];
          const middle = hand[9];

          const connections = [[0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8], [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16], [13,17],[17,18],[18,19],[19,20], [0,17]];
          
          const state = this.currentDriveState();
          ctx.strokeStyle = state === 'BRAKING' ? '#ef4444' : (state === 'GAS' ? '#22c55e' : '#facc15');
          ctx.lineWidth = 3;
          
          for(const [i,j] of connections) {
              const p1 = hand[i];
              const p2 = hand[j];
              ctx.beginPath();
              ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
              ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
              ctx.stroke();
          }

          if(landmarks.length === 1) {
              // Draw visual guide line
              ctx.beginPath();
              ctx.moveTo(wrist.x * canvas.width, wrist.y * canvas.height);
              ctx.lineTo(middle.x * canvas.width, middle.y * canvas.height);
              ctx.strokeStyle = 'white';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);
              ctx.stroke();
              ctx.setLineDash([]);
              
              // Target Reticle
              ctx.beginPath();
              ctx.arc(middle.x * canvas.width, middle.y * canvas.height, 10, 0, 2*Math.PI);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.fill();
          }
      }

      if(landmarks.length === 2 && this.isTwoHandMode()) {
          const h1 = landmarks[0][9];
          const h2 = landmarks[1][9];
          const cx = ((h1.x + h2.x) / 2) * canvas.width;
          const cy = ((h1.y + h2.y) / 2) * canvas.height;
          const radius = Math.max(40, Math.sqrt(Math.pow((h1.x - h2.x)*canvas.width, 2) + Math.pow((h1.y - h2.y)*canvas.height, 2)) / 2.2);

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(this.virtualSteerAngle() * (Math.PI / 180)); 
          
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; 
          ctx.lineWidth = 6;
          ctx.arc(0, 0, radius, 0, 2 * Math.PI);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0);
          ctx.stroke();
          ctx.restore();
      }
  }

  processHands(landmarks: any[][]) {
      let steerInput = 0; 
      let driveState: 'GAS' | 'BRAKING' | 'NEUTRAL' = 'NEUTRAL';
      
      if(landmarks.length === 0) {
          this.isTwoHandMode.set(false);
          steerInput = 0; 
          driveState = 'BRAKING'; // Auto brake if no hands
      } else if (landmarks.length === 1) {
          this.isTwoHandMode.set(false);
          const hand = landmarks[0];
          const wrist = hand[0];
          const middleKnuckle = hand[9]; 
          
          // Tilt Logic:
          const xDiff = middleKnuckle.x - wrist.x;
          steerInput = xDiff * -7.0; // Increased sensitivity for easier control

          // Fist Logic
          const tips = [hand[8], hand[12], hand[16], hand[20]];
          const avgDist = tips.reduce((s, t) => s + Math.hypot(t.x - wrist.x, t.y - wrist.y), 0) / 4;
          
          if (avgDist > 0.35) driveState = 'BRAKING'; 
          else if (avgDist < 0.25) driveState = 'GAS'; 
          else driveState = 'NEUTRAL';

      } else if (landmarks.length === 2) {
          this.isTwoHandMode.set(true);
          const h1 = landmarks[0][9];
          const h2 = landmarks[1][9];
          
          const left = h1.x < h2.x ? h1 : h2;
          const right = h1.x < h2.x ? h2 : h1;
          
          const dy = right.y - left.y;
          const dx = right.x - left.x;
          
          const angle = Math.atan2(dy, dx); 
          steerInput = angle * -2.5; 
          
          this.virtualSteerAngle.set(angle * (180/Math.PI)); 
          driveState = 'GAS'; 
      }

      steerInput = Math.max(-1, Math.min(1, steerInput));
      this.targetSteer = steerInput;
      this.currentDriveState.set(driveState);
  }

  async initAudio() {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.bgmAudio = new Audio(BGM_URL);
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = 0.2; 
      this.bgmAudio.crossOrigin = 'anonymous';
      this.bgmAudio.onerror = (e) => console.warn('Audio load error', e);
  }
  
  startAudio() {
      if(!this.audioCtx) return;
      if(this.audioCtx.state === 'suspended') this.audioCtx.resume();
      this.bgmAudio?.play().catch(() => {});

      this.engineOsc1 = this.audioCtx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      
      this.engineOsc2 = this.audioCtx.createOscillator();
      this.engineOsc2.type = 'sawtooth';

      this.engineGain = this.audioCtx.createGain();
      this.engineGain.gain.value = 0.1; 
      
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;

      this.engineOsc1.connect(filter);
      this.engineOsc2.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.audioCtx.destination);
      
      this.engineOsc1.start();
      this.engineOsc2.start();
  }
  
  stopAudio() {
      if(this.engineOsc1) {
          try { this.engineOsc1.stop(); this.engineOsc2?.stop(); } catch(e){}
          this.engineOsc1 = null;
          this.engineOsc2 = null;
      }
      this.bgmAudio?.pause();
  }

  ngOnDestroy() {
      if(this.animId) cancelAnimationFrame(this.animId);
      if(this.cvId) cancelAnimationFrame(this.cvId);
      this.stopAudio();
      this.audioCtx?.close();
      window.removeEventListener('keydown', this.keydownListener);
  }
}
