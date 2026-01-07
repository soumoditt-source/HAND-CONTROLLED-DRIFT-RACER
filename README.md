
# Gesture Racer 3D 🏎️✋

> **"The future of gaming is in your hands."**

![Status](https://img.shields.io/badge/Status-Stable-success)
![License](https://img.shields.io/badge/License-Proprietary-red)
![Author](https://img.shields.io/badge/Author-Soumoditya%20Das-blue)

A professional-grade 3D racing simulator controlled entirely by real-time computer vision hand gestures. Built with high-performance web technologies, it features physics-based drifting, dynamic day/night cycles, and smart traffic AI.

**Created & Designed by Soumoditya Das**  
*(soumoditt@gmail.com)*

---

## 🎮 Gameplay Features

*   **Gesture Control System**:
    *   **Accelerate**: Open Palm ✋
    *   **Brake**: Clenched Fist ✊
    *   **Steer**: Tilt hands left/right relative to each other 👐
*   **Advanced Physics Engine**:
    *   Slip-angle based drifting mechanics.
    *   6-Speed automatic transmission logic.
    *   Speed-dependent steering sensitivity.
*   **Immersive Audio**:
    *   Procedural engine sound synthesis (RPM-based pitch shifting).
    *   Dynamic wind and drift noise generation.
*   **Visual Fidelity**:
    *   Low-poly 3D vehicle models (Sedans, Trucks, Sport Cars).
    *   Dynamic FOV (Field of View) speed effects.
    *   Procedural endless terrain generation.

---

## 🛠️ Technical Stack

This project leverages the bleeding edge of browser capabilities:

| Domain | Technology | Usage |
| :--- | :--- | :--- |
| **Frontend Framework** | **Angular v21** | Core application structure, Zoneless change detection, Signals. |
| **Language** | **TypeScript** | Strict typing for physics logic and state management. |
| **3D Rendering** | **Three.js (WebGL)** | Rendering the scene graph, materials, lighting, and shadows. |
| **Computer Vision** | **MediaPipe Tasks** | Real-time hand landmark detection via WebAssembly (WASM) & GPU. |
| **Audio** | **Web Audio API** | Zero-latency procedural sound generation. |
| **Styling** | **Tailwind CSS** | HUD layout and responsive design. |

---

## 🚀 Installation & Running

This project is built to run entirely client-side.

### Prerequisites
*   Node.js (LTS Version)
*   A webcam connected to your device.

### Local Development
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/gesture-racer.git
    cd gesture-racer
    ```

2.  **Serve the application**:
    Due to browser security policies regarding camera access and ES Modules, you must run this on a local server (HTTPS or localhost).

    *Method A: Python (Recommended)*
    ```bash
    python3 -m http.server 8000
    ```
    
    *Method B: Node HTTP Server*
    ```bash
    npx http-server .
    ```

3.  **Play**:
    Open your browser to `http://localhost:8000`.

---

## 📷 Troubleshooting

**"Error: Camera Access Required"**
*   **Check Browser Permissions**: Ensure you have allowed camera access in the URL bar.
*   **Secure Context**: Browsers only allow camera access on `localhost` or `https://`. If you access via IP (e.g., `192.168.1.5`), it will fail.
*   **Lighting**: Ensure your hands are well-lit for the best tracking performance.

---

## 📜 Copyright & License

**Copyright © 2024 Soumoditya Das.**  
All rights reserved.

This software involves complex original algorithms for gesture-to-steering mapping and procedural content generation. Unauthorized reproduction, distribution, or commercial use is strictly prohibited without explicit permission from the author.

**Contact**: soumoditt@gmail.com
