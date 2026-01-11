
# Gesture Racer 3D: Megatronix Edition (v9.8) 🏎️✨

**The Definitive Browser Racing Experience powered by Computer Vision.**

![Status](https://img.shields.io/badge/Build-Stable_Production-success)
![AI](https://img.shields.io/badge/AI-Megatronix_Vision-blue)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black)

Controls a high-speed vehicle using hand gestures captured via webcam. No keyboard, no controller, just you and your webcam.

---

## 🌟 Key Features

*   **Megatronix Vision AI**: Uses Linear Algebraic Vector Math on 21 MediaPipe Landmarks for ultra-smooth, low-latency steering control.
*   **Performance Engine**: Decoupled rendering loop (60 FPS) and AI inference loop (30 FPS) ensures zero-lag gameplay even on mid-range devices.
*   **Synthwave Aesthetics**: Dynamic neon lighting, glowing road edges, and procedural infinite city generation.
*   **Economy & Garage**: Earn credits, unlock cars, and view them in a 360° showroom.
*   **Local Leaderboards**: Track your high scores and compete locally.

---

## 🎮 How to Play

1.  **Initiate Race**: Enter your alias (Required every race for fair competition).
2.  **Controls**:
    *   **Accelerate**: Open Palm ✋
    *   **Brake**: Closed Fist ✊
    *   **Steer (1 Hand)**: Move hand left/right (Joystick mode).
    *   **Steer (2 Hands)**: Hold hands like a virtual steering wheel and rotate.
3.  **Visual Feedback**:
    *   **Green Skeleton**: Gas Active.
    *   **Red Skeleton**: Braking Active.
    *   **Yellow Skeleton**: Neutral/Coast.
    *   **Dots**: The 21 tracking points on your hand joints.

---

## 🛠️ System Architecture

*   **Framework**: Angular 18+ (Zoneless Architecture)
*   **3D Engine**: Three.js (WebGL 2.0)
*   **Computer Vision**: Google MediaPipe Hand Landmarker (GPU Accelerated)
*   **Math**: Vector-based steering calculation with Exponential Moving Average (EMA) smoothing.

### Performance Optimization
To prevent freezing/lag:
1.  **Loop Throttling**: CV prediction runs every ~32ms, decoupling it from the 16ms render frame.
2.  **Asset Pooling**: Obstacles and Coins are recycled in object pools, preventing Garbage Collection spikes.
3.  **Strict Lifecycle Management**: All loops are explicitly cancelled before state transitions.

---

## 🚀 Deployment Guide (Vercel)

1.  **Install Angular CLI**: `npm install -g @angular/cli`
2.  **Create Project**: `ng new gesture-racer`
3.  **Copy Source**: Overwrite `src/` with this repository.
4.  **Deploy**:
    *   Build Command: `ng build`
    *   Output Directory: `dist/gesture-racer-3d/browser`

---

**Developed by Soumoditya Das & Team Megatronix 2026**
*(The Official Tech Club of MSIT)*
