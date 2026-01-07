
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './src/app.component';

/* 
 * Entry point for Gesture Racer 3D
 * Copyright (c) 2024 Soumoditya Das.
 */

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection()
  ],
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
