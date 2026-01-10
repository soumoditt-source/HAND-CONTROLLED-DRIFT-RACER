
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './src/app.component';

/* 
 * Entry point for Gesture Racer 3D
 * Created by Soumoditya Das & Team Megatronix 2026
 * The Official Tech Club of MSIT
 */

// Service Worker Registration for Offline Capabilities (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection()
  ],
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
