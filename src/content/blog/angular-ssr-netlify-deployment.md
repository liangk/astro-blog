---
title: "Angular 20 SSR Deployment to Netlify: The Complete Guide"
pubDate: "2025-11-10"
heroImage: '../../assets/angular-ssr-netlify-deployment.webp'
author: "Ko-Hsin Liang"
categories: ["Angular", "Deployment", "SSR", "Netlify", "Authentication"]
repo: ""
description: "The honest path to deploying Angular 20 SSR with httpOnly cookie authentication to Netlify. No hand-waving—just the build configurations, Netlify functions, and troubleshooting that actually work."
metaDescription: "Complete guide to deploying Angular 20 SSR to Netlify with httpOnly cookies. Covers serverless functions, platform-aware auth, force=false routing, and production troubleshooting."
keywords: ["angular 20 ssr deployment", "netlify angular ssr", "httponly cookies netlify", "angular serverless functions", "netlify ssr configuration", "angular production deployment", "angular ssr authentication", "netlify force false"]
ogTitle: "Angular 20 SSR on Netlify: Complete Deployment Guide with httpOnly Cookies"
ogDescription: "Deploy Angular 20 with server-side rendering and httpOnly cookie authentication to Netlify. The working configuration with serverless functions and troubleshooting."
ogImage: "/assets/angular-ssr-netlify-deployment.webp"
ogType: "article"
twitterCard: "summary_large_image"
twitterCreator: "@stackinsightDev"
section: "Deployment"
tags: ["Angular", "SSR", "Netlify", "Deployment", "Authentication", "httpOnly Cookies", "Serverless Functions", "Server-Side Rendering", "Production"]
readTime: 30
wordCount: 6500
canonicalUrl: "https://stackinsight.dev/blog/angular-ssr-netlify-deployment"
---

# Angular 20 SSR Deployment to Netlify: The Complete Guide

*The honest path to deploying Angular SSR with httpOnly cookie authentication—no hand-waving, just the configurations and troubleshooting that actually work*

**Last updated**: November 2025 | Angular 20.2+ | Node.js 20 | Netlify

> 💡 **Note**: This guide is based on production implementations. For a complete, production-ready Angular SSR authentication boilerplate, check out [StackInsight Auth Pro](https://stackinsight.app).

---

## The Real Talk: This Isn't Your Average Deployment

**The dream**: You've built an Angular app with server-side rendering. You're ready to deploy to Netlify and watch those SEO rankings soar.

**The reality**: You're three hours deep into cryptic build errors, your SSR function returns empty `<app-root>` tags, and your users keep getting logged out on every page refresh despite having perfectly valid httpOnly cookies.

I've been there. Multiple times.

Here's the thing—deploying Angular SSR to Netlify with httpOnly cookie authentication isn't just a matter of clicking "Deploy." It's navigating a minefield of:
- Build configurations that changed significantly in Angular 17-20
- Platform-aware code that needs to know if it's running on a server or in a browser
- Netlify serverless functions that require specific file structures
- Static asset routing that breaks if you get one setting wrong

But here's the good news: once you understand the "why" behind each configuration, it all clicks into place. And that's exactly what this guide is for.

### What You're Actually Building

By the end of this guide, you'll have:
- ✅ **Angular SSR rendering full HTML on first load** (verified in page source, not just trust)
- ✅ **httpOnly cookie authentication that works correctly** (no more login loops on refresh)
- ✅ **Netlify serverless SSR function** that handles both modern ESM and legacy CommonJS bundles
- ✅ **Static assets served from global CDN** with optimal caching strategies
- ✅ **Understanding of why each piece matters** so you can debug when Angular 21 changes things

This isn't a "copy these commands and hope" tutorial. We're going to understand what we're deploying and why it's configured this way.

### Who This Guide Is For

You should already have:
- An Angular 20 application with SSR configured (`@angular/ssr` package installed)
- Authentication using httpOnly cookies (the XSS-proof way)
- A backend API already deployed somewhere (Render, Railway, DigitalOcean, etc.)

If you don't have SSR set up yet, run `ng add @angular/ssr` first. If you're not using httpOnly cookies, you can skip the authentication sections—but you should really consider switching to them.

### The Path Ahead

We'll tackle this in logical order:

1. **Understanding the Architecture** - What Netlify is actually doing with your app
2. **Solving the httpOnly Cookie Problem** - Why auth breaks during SSR and how to fix it
3. **Configuring the Build** - Getting Angular to generate the right files
4. **Creating the Netlify Function** - The serverless wrapper that makes SSR work
5. **Deploying and Verifying** - Making sure it actually works
6. **Troubleshooting** - When things go wrong (they will)

Let's dive in.

---

## Prerequisites

### Required Accounts
- **Netlify account** (free tier works)
- **Backend API deployed** (Express/Node backend running elsewhere)

### Required Tools
```bash
# Check versions
node --version    # Should be v20.x or higher
ng version        # Should be Angular CLI 20.x
npm --version     # Should be 10.x or higher
```

### Your Codebase Must Have
- Angular 20 with SSR configured (`@angular/ssr` installed)
- Authentication using httpOnly cookies
- Backend API sending JWT via `Set-Cookie` headers

**Verify SSR is configured:**
```bash
ls src/main.server.ts  # Must exist
ls server.ts           # Express server must exist
```

If `src/main.server.ts` doesn't exist, add SSR first:
```bash
ng add @angular/ssr
```

---

## Understanding What You're Deploying

### The Netlify SSR Model (And Why It's Different)

Here's what most people miss: when you deploy an Angular SSR app to Netlify, you're not deploying a traditional web server. You're deploying two completely separate things:

**1. Static Files** (your `browser/` folder)
- These go to Netlify's global CDN
- Think: JavaScript bundles, CSS, images, fonts
- Served blazing fast from the edge
- Cached for a year (because they're versioned with hashes)

**2. A Serverless Function** (your `server/` folder)
- This is the SSR magic
- Spins up on-demand when a user hits a route
- Renders your Angular app to HTML
- Returns fully-formed pages

**The Request Flow (What Actually Happens):**

Let's walk through what happens when a user visits `https://yourapp.netlify.app/dashboard`:

```
┌─────────────────────────────────────────────────────────────────┐
│  User Requests: https://yourapp.netlify.app/dashboard          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Netlify CDN (Edge)                          │
│  Decision: Is this a static file or an app route?              │
└─────┬───────────────────────────────────────────────────┬───────┘
      │                                                   │
      │ Static File                                       │ App Route
      │ (main.abc123.js, styles.css, images)            │ (/dashboard, /profile)
      ▼                                                   ▼
┌─────────────────────┐                    ┌──────────────────────────┐
│  Serve from CDN     │                    │  Invoke SSR Function     │
│  ✅ Fast (< 10ms)   │                    │  ⏱️  50-200ms cold       │
│  ✅ Cached globally │                    │  ⏱️  ~10ms warm          │
│  ✅ Status: 200     │                    └────────┬─────────────────┘
└─────────────────────┘                             │
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │ Angular SSR Renders on Server │
                                    │ - Executes components         │
                                    │ - Generates full HTML         │
                                    │ - Returns to user             │
                                    └───────────┬───────────────────┘
                                                │
      ┌─────────────────────────────────────────┴─────────────┐
      │                                                         │
      ▼                                                         ▼
┌─────────────────────┐                          ┌──────────────────────┐
│  User sees HTML     │                          │  Browser downloads   │
│  immediately        │                          │  JavaScript from CDN │
│  ✅ No spinner!     │                          │  (main.abc123.js)    │
│  ✅ Content visible │                          └──────────┬───────────┘
└─────────────────────┘                                     │
                                                            ▼
                                              ┌─────────────────────────┐
                                              │  Angular Hydrates       │
                                              │  ✅ Attaches listeners  │
                                              │  ✅ App is interactive  │
                                              └─────────────────────────┘
```

**Why this matters**: If you configure the redirect wrong, everything (including `.js` files) goes to the SSR function. Your app loads HTML but never becomes interactive because the JavaScript never loads. This is the #1 deployment mistake.

### What Angular Actually Builds

When you run `ng build --configuration production` with SSR enabled, Angular creates this structure:

```
dist/frontend/
├── browser/                    # What users download
│   ├── index.html             # Main template (with <link> and <script> tags injected)
│   ├── index.csr.html         # Fallback if SSR fails
│   ├── main.abc123.js         # Your app code (hash = cache-busting)
│   ├── styles.xyz789.css      # Compiled styles (hash = cache-busting)
│   └── assets/                # Images, fonts, etc.
│
└── server/                    # What Netlify runs
    ├── main.server.mjs        # ESM server bundle (modern builder)
    ├── main.js                # CommonJS bundle (deprecated builder)
    ├── index.server.html      # Template for SSR
    └── angular-app-engine-manifest.mjs
```

**Here's the catch**: Angular 20's new `application` builder generates `main.server.mjs` (ESM modules), but the older `server` builder generates `main.js` (CommonJS). Your Netlify function needs to handle BOTH, because:
- The modern builder is what you use in production (`"ssr": true`)
- But you might also use the deprecated builder (it's more reliable for dual-mode builds)
- Different Angular versions behave differently

**Pro tip**: Always check which file actually got created after your build. Don't assume.

---

## The httpOnly Cookie Authentication Problem (And Why It's Sneaky)

### What's Actually Going Wrong

This is the issue that will drive you crazy if you don't understand what's happening.

**The scenario**: You've implemented secure authentication with httpOnly cookies (good choice—they're immune to XSS attacks). Your backend sends JWT tokens via `Set-Cookie` headers. Everything works perfectly in development.

Then you deploy with SSR and suddenly:
- Users log in successfully
- They navigate to a protected route like `/dashboard`
- They see the page
- **They refresh the page**
- They're instantly kicked to `/login`
- Confused, they log in again
- Refresh again → kicked out again
- They start questioning their life choices

**Here's why this happens**:

```
┌────────────────────────────────────────────────────────────────┐
│  PHASE 1: Server-Side Render (The Problem)                    │
└────────────────────────────────────────────────────────────────┘

User Refreshes Page (/dashboard)
        │
        ▼
┌──────────────────────────────────────────┐
│  Netlify SSR Function Starts            │
│  - Angular renders on Node.js server    │
│  - APP_INITIALIZER runs                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Auth Check Attempts                     │
│  GET /api/auth/profile                   │
│  ❌ httpOnly cookies NOT accessible      │
│  ❌ Request sent WITHOUT cookies         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Backend Response                        │
│  401 Unauthorized                        │
│  (no auth cookie received)               │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Angular SSR Thinks                      │
│  "Not logged in!"                        │
│  Redirects to /login                     │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  HTML Returned to Browser                │
│  <meta http-equiv="refresh"              │
│        content="0; url=/login">          │
│  ❌ User kicked out                      │
└──────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  PHASE 2: Client Hydration (Too Late)                         │
└────────────────────────────────────────────────────────────────┘

Browser Receives HTML
        │
        ▼
┌──────────────────────────────────────────┐
│  JavaScript Downloads & Runs             │
│  ✅ NOW httpOnly cookies ARE accessible  │
│  ✅ Auth would work here                 │
│  ❌ But redirect already happened        │
└──────────────────────────────────────────┘
```

**The key insight**: httpOnly cookies work ONLY in the browser, not on the server. During SSR, the server-side JavaScript cannot access them, so any auth check fails.

### The Real Solution: Platform-Aware Code

We need to teach our Angular app: "If you're running on a server, SKIP the auth check. Let the client handle it."

Here's how we do that:

### Step 1: Update `app.config.ts`

```typescript
import { ApplicationConfig, APP_INITIALIZER, Injector } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { errorInterceptor } from './interceptors/error.interceptor';
import { AuthService } from './services/auth.service';

export function initializeAuth(authService: AuthService, injector: Injector, platformId: object) {
  return () => {
    // Skip auth check during SSR - let client handle it
    if (!isPlatformBrowser(platformId)) {
      console.log('[APP_INITIALIZER] SSR mode - skipping auth check');
      return Promise.resolve();
    }
    
    // Client-side: validate auth with httpOnly cookies
    console.log('[APP_INITIALIZER] Client mode - checking auth');
    return authService.ensureAuth(true).toPromise();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, errorInterceptor])
    ),
    provideAnimations(),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      deps: [AuthService, Injector, PLATFORM_ID],
      multi: true
    }
  ]
};
```

### Step 2: Update Auth Guard

```typescript
import { CanActivateFn, Router } from '@angular/router';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // On server-side, allow navigation (client will validate)
  if (!isPlatformBrowser(platformId)) {
    console.log('[authGuard] SSR detected, allowing route');
    return true;
  }

  // On client-side, check if already authenticated
  if (auth.isCurrentlyAuthenticated()) {
    return true;
  }

  // Attempt auth validation
  return auth.ensureAuth().pipe(
    map((isAuthed) => {
      if (!isAuthed) {
        auth.setRedirectUrl(state.url || '/');
        router.navigate(['/login']);
        return false;
      }
      return true;
    })
  );
};
```

### Step 3: Update Auth Interceptor

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  // Always send cookies for authentication
  const cloned = req.clone({ withCredentials: true });

  return next(cloned).pipe(
    catchError((error) => {
      // Skip interceptor logic on server-side
      if (!isPlatformBrowser(platformId)) {
        return throwError(() => error);
      }

      // Client-side error handling...
      return throwError(() => error);
    })
  );
};
```

**Key Points:**
- ✅ Skip auth during SSR to avoid blocking server render
- ✅ Always use `withCredentials: true` in HTTP requests
- ✅ Client validates auth after hydration
- ✅ httpOnly cookies sent automatically by browser

---

## Configuring the Production Build

### Step 1: Configure `angular.json`

Your `angular.json` needs both modern and deprecated builder configurations:

```json
{
  "projects": {
    "frontend": {
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist/frontend",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "polyfills": ["zone.js"],
            "tsConfig": "tsconfig.app.json",
            "assets": ["src/assets"],
            "styles": ["src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "outputHashing": "all",
              "optimization": true,
              "sourceMap": false,
              "extractLicenses": true,
              "namedChunks": false,
              "server": "src/main.server.ts",
              "ssr": true
            }
          },
          "defaultConfiguration": "production"
        },
        "server": {
          "builder": "@angular-devkit/build-angular:server",
          "options": {
            "outputPath": "dist/frontend/server",
            "main": "src/main.server.ts",
            "tsConfig": "tsconfig.server.json"
          },
          "configurations": {
            "production": {
              "optimization": true,
              "outputHashing": "media",
              "sourceMap": false,
              "extractLicenses": true
            }
          },
          "defaultConfiguration": "production"
        }
      }
    }
  }
}
```

**Why both builders?**
- Modern `application` builder generates optimized bundles and enables `"ssr": true`
- Deprecated `server` builder ensures reliable CommonJS server bundles
- This dual approach maximizes compatibility

### Step 2: Configure TypeScript Files

**`tsconfig.server.json`** - Only Angular server code:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/server",
    "target": "ES2022",
    "module": "ESNext",
    "types": ["node"]
  },
  "files": ["src/main.server.ts"],
  "exclude": ["server.ts"]
}
```

**`tsconfig.app.json`** - Exclude server files:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.d.ts"],
  "exclude": ["server.ts", "src/**/*.spec.ts"]
}
```

**Critical:** `server.ts` (your Express wrapper) must be excluded from ALL Angular TypeScript configs.

### Step 3: Configure Build Scripts

**`package.json`:**
```json
{
  "scripts": {
    "build:ssr": "ng build --configuration production && ng run frontend:server:production && node scripts/copy-index.js && node scripts/stage-ssr-assets.mjs"
  }
}
```

**Build process:**
1. `ng build --configuration production` → Browser and server bundles (with `"ssr": true`)
2. `ng run frontend:server:production` → Additional CommonJS server bundle
3. `node scripts/copy-index.js` → Copy HTML template
4. `node scripts/stage-ssr-assets.mjs` → Stage assets for Netlify

### Step 4: Create Copy Script

**`scripts/copy-index.js`:**
```javascript
const fs = require('fs');
const path = require('path');

const browserIndexCandidates = [
  path.join(__dirname, '../dist/frontend/browser/index.html'),
  path.join(__dirname, '../dist/frontend/browser/index.csr.html'),
];
const serverDestFile = path.join(__dirname, '../dist/frontend/server/index.server.html');
const browserCsrFile = path.join(__dirname, '../dist/frontend/browser/index.csr.html');

try {
  const sourceFile = browserIndexCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sourceFile) {
    throw new Error('Angular build did not produce dist/frontend/browser/index.html or index.csr.html');
  }

  fs.copyFileSync(sourceFile, serverDestFile);
  if (sourceFile !== browserCsrFile) {
    fs.copyFileSync(sourceFile, browserCsrFile);
  }
  console.log('✓ Synced built index template to server/index.server.html and browser/index.csr.html');
} catch (err) {
  console.error('✗ Failed:', err.message);
  process.exit(1);
}
```

### Step 5: Create Staging Script

**`scripts/stage-ssr-assets.mjs`:**
```javascript
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = join(__dirname, '../dist/frontend/server');
const browserSource = join(__dirname, '../dist/frontend/browser');
const assetsDestination = join(__dirname, '../netlify/functions/.ssr-assets');

if (!existsSync(assetsDestination)) {
  mkdirSync(assetsDestination, { recursive: true });
}

cpSync(serverSource, join(assetsDestination, 'server'), { recursive: true });
cpSync(browserSource, join(assetsDestination, 'browser'), { recursive: true });

console.log('✓ Staged SSR assets to netlify/functions/.ssr-assets');
```

---

## Creating the Netlify SSR Function

Create `netlify/functions/ssr.ts` to handle server-side rendering in Netlify's serverless environment:

```typescript
import 'zone.js/node';
import '@angular/compiler';
import type { Handler } from '@netlify/functions';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { APP_BASE_HREF } from '@angular/common';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// server/ and browser/ are staged inside .ssr-assets next to this function
const assetsDir = join(__dirname, '.ssr-assets');
const serverDir = join(assetsDir, 'server');
const browserDir = join(assetsDir, 'browser');
const indexHtml = join(serverDir, 'index.server.html');

let bootstrap: any;
let renderApplicationFn: any;

export const config = {
  includedFiles: ['.ssr-assets/**'],
} as const;

export const handler: Handler = async (event) => {
  const url = event.rawUrl || `https://${event.headers.host}${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`;

  try {
    // Lazy load server bundle on first request
    if (!bootstrap || !renderApplicationFn) {
      const candidates = ['main.server.mjs', 'main.js'];
      let loaded: any;
      
      for (const candidate of candidates) {
        const candidatePath = join(serverDir, candidate);
        if (existsSync(candidatePath)) {
          console.log('Loading server bundle:', candidate);
          loaded = await import(pathToFileURL(candidatePath).href);
          break;
        }
      }

      if (!loaded) {
        throw new Error('No server bundle found (expected main.server.mjs or main.js)');
      }

      const maybeDefault = loaded.default ?? loaded;
      renderApplicationFn = maybeDefault.renderApplication ?? loaded.renderApplication;
      if (!renderApplicationFn) {
        throw new Error('renderApplication not found in server bundle');
      }

      bootstrap = maybeDefault.default ?? maybeDefault.bootstrap ?? loaded.default ?? loaded.bootstrap ?? loaded;
    }

    const document = readFileSync(indexHtml, 'utf8');

    const html = await renderApplicationFn(bootstrap, {
      document,
      url,
      platformProviders: [{ provide: APP_BASE_HREF, useValue: '/' }],
      publicPath: browserDir
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  } catch (err) {
    console.error('SSR failed:', err);
    // Fallback to CSR
    try {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: readFileSync(join(browserDir, 'index.csr.html'), 'utf8')
      };
    } catch {
      return { statusCode: 500, body: 'Render failed' };
    }
  }
};
```

**Key Features:**
- ✅ Dynamically imports either ESM (`main.server.mjs`) or CommonJS (`main.js`)
- ✅ Uses `renderApplication()` from server bundle (compatible with standalone apps)
- ✅ Fallback to CSR if SSR fails
- ✅ Proper error handling and logging
- ✅ Lazy loads bundle on first request for faster cold starts

---

## Configuring Netlify Deployment (The Make-or-Break Step)

This is where most deployments fail. Not because the configuration is complex, but because one tiny setting breaks everything in a non-obvious way.

### Step 1: Create `netlify.toml` (In the Right Place!)

First, location matters. This file goes in your **project root**, NOT inside `frontend/`.

**If you have a monorepo**:
```
my-fullstack-app/
├── frontend/      (Angular app)
├── backend/       (Node API)
└── netlify.toml   (← HERE!)
```

**Why?** Netlify looks for `netlify.toml` at the repository root. If it's inside `frontend/`, Netlify won't find it and will ignore all your settings.

Now let's create it:

```toml
[build]
  base = "frontend"
  command = "npm run build:ssr"
  publish = "dist/frontend/browser"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"
  included_files = ["netlify/functions/.ssr-assets/**"]

[[redirects]]
  from = "/*"
  to = "/.netlify/functions/ssr"
  status = 200
  force = false

# Cache static assets
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=31536000"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=31536000"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[env.production]
  NODE_ENV = "production"
```

**Let's break down what each setting actually does:**

**`[build]` section** - Tells Netlify how to build your app:

- `base = "frontend"` 
  - **What it does**: Runs all commands from inside the `frontend/` directory
  - **Why it matters**: Without this, Netlify would try to run `npm run build:ssr` from your project root, where there's no `package.json`
  - **Result**: Build would fail immediately with "command not found"

- `command = "npm run build:ssr"`
  - **What it does**: The exact command to build your app
  - **Why it matters**: This needs to match your `package.json` script name exactly
  - **Common mistake**: Using `npm run build` instead of `npm run build:ssr` (won't generate server bundle)

- `publish = "dist/frontend/browser"`
  - **What it does**: Where your static files are after the build
  - **Why it matters**: These files go to Netlify's CDN for fast global delivery
  - **Path is relative to**: The `base` directory (so `frontend/dist/frontend/browser`)

- `functions = "netlify/functions"`
  - **What it does**: Where your SSR function code lives
  - **Why it matters**: Netlify bundles this into a serverless function
  - **Path is relative to**: The repository root

**`[functions]` section** - Configures serverless function behavior:

- `node_bundler = "esbuild"`
  - **What it does**: Uses esbuild (fast) instead of webpack (slower) to bundle your function
  - **Why it matters**: Faster builds, better ESM support
  - **Critical**: Required for modern Angular SSR bundles

- `included_files = ["netlify/functions/.ssr-assets/**"]`
  - **What it does**: Forces Netlify to include these files in the function bundle
  - **Why it matters**: Without this, Netlify might skip `index.server.html` and other assets
  - **Result of missing this**: "File not found" errors during SSR

**`[[redirects]]` section** - The routing magic:

- `from = "/*"` and `to = "/.netlify/functions/ssr"`
  - **What it does**: Routes requests to your SSR function
  - **But here's the critical part**: `force = false`

**Why `force = false` is THE most important setting:**

When `force = true` (the default):
- ALL requests go to the SSR function
- Including `main.abc123.js`, `styles.xyz789.css`, images, everything
- Your SSR function returns HTML for JavaScript file requests
- Browsers try to execute HTML as JavaScript → error
- Result: Your app loads HTML but never becomes interactive (no hydration)

When `force = false`:
- Netlify checks: "Do I have a file at this exact path?"
- If YES (like `main.abc123.js`) → Serve it from CDN
- If NO (like `/dashboard`) → Route to SSR function
- Result: Static files load, hydration works, your app is interactive

**This single setting causes 90% of "SSR deployed but app doesn't work" issues.**

### Step 2: Clear Netlify Dashboard Settings

**Critical:** Netlify dashboard settings override `netlify.toml`. You must clear them:

1. Log into Netlify Dashboard
2. Select your site
3. Go to **Site settings** → **Build & deploy** → **Build settings**
4. Click **Edit settings**
5. **Clear ALL fields** (leave empty):
   - Base directory: `(empty)`
   - Build command: `(empty)`
   - Publish directory: `(empty)`
   - Functions directory: `(empty)`
6. Click **Save**
7. Verify all show "Not set"

---

## Deployment and Verification

### Step 1: Test Build Locally

```bash
cd frontend

# Clean build
rm -rf dist netlify/functions/.ssr-assets

# Build with SSR
npm run build:ssr

# Verify output
ls dist/frontend/browser/    # Should have index.html, *.js, *.css
ls dist/frontend/server/     # Should have main.js or main.server.mjs, index.server.html
ls netlify/functions/.ssr-assets/  # Should have server/ and browser/
```

### Step 2: Deploy to Netlify

```bash
# From project root
git add .
git commit -m "feat: add Angular SSR with Netlify deployment"
git push origin main
```

**Watch the build:**
1. Go to Netlify Dashboard → **Deploys**
2. Click the in-progress deploy
3. Watch for success messages:
   ```
   ✓ Synced built index template to server/index.server.html
   ✓ Staged SSR assets to netlify/functions/.ssr-assets
   Build succeeded
   Functions bundled successfully
   ```

### Step 3: Verify SSR is Working

**Test 1: View Page Source**
1. Visit your Netlify URL
2. Right-click → "View Page Source" (Ctrl+U / Cmd+U)
3. **✅ Success:** Full HTML content inside `<app-root>`
4. **❌ Failure:** Empty `<app-root></app-root>`

**Test 2: Check Network Tab**
1. Open DevTools → Network tab
2. Refresh the page
3. Click the first HTML request
4. **✅ Success:** Response shows full rendered HTML (20-50 KB)
5. **❌ Failure:** Response is just empty template (< 5 KB)

**Test 3: Test Authentication**
1. Log into your app
2. Refresh the page (F5)
3. **✅ Success:** Stay logged in, no redirect
4. **❌ Failure:** Redirected to /login (review auth config)

**Test 4: Test Routing**
1. Navigate to `/dashboard`, `/profile`, etc.
2. Refresh on each page
3. **✅ Success:** Content loads immediately, URL stays the same
4. **❌ Failure:** Redirected to `/` or shows 404

**Test 5: Check Static Assets**
1. Open DevTools → Network tab
2. Look for `main.*.js` and `styles.*.css`
3. **✅ Success:** Status 200, served from Netlify (not function)
4. **❌ Failure:** 404 or served with wrong Content-Type

---

## Troubleshooting (When Things Go Wrong)

Let's be honest—they will go wrong. Here are the most common issues, their symptoms, what's actually causing them, and how to fix them.

### Problem 1: "404 Not Found" on All Routes Except Homepage

**What you see:**
- Homepage loads fine
- Navigate to `/dashboard` → works
- Refresh on `/dashboard` → 404 error
- Direct visit to `/dashboard` → 404 error

**What's actually happening:**
Netlify doesn't know that `/dashboard` should trigger your SSR function. It's looking for a file called `dashboard` in your `publish` directory, not finding it, and returning 404.

**The fix:**

Ensure `netlify.toml` has `force = false` in the redirect:
```toml
[[redirects]]
  from = "/*"
  to = "/.netlify/functions/ssr"
  status = 200
  force = false  # ← Must be false
```

### Problem 2: Page Loads But Nothing Works (No Clicks, No Interactions)

**What you see:**
- Page loads and looks correct
- You can see your content and styles
- But clicking buttons does nothing
- Forms don't submit
- Navigation doesn't work
- Console shows JavaScript errors like "Unexpected token '<'"

**What's actually happening:**
Your HTML is loading, but the JavaScript files aren't. When you open DevTools → Network tab, you'll see requests for `main.abc123.js` returning HTML instead of JavaScript. 

This happens when `force = true` in your redirect—everything goes to the SSR function, including JS files. The SSR function returns HTML for every request, even `.js` files.

**The fix:**

Same as Problem 1—set `force = false`:
```toml
[[redirects]]
  from = "/*"
  to = "/.netlify/functions/ssr"
  status = 200
  force = false  # ← Critical!
```

After deploying, verify in Network tab that `.js` files show `Content-Type: application/javascript`, not `text/html`.

### Problem 3: Styles Not Loading (Unstyled HTML)

**What you see:**
- Content appears but looks like a 1995 website
- No colors, no layout, just basic HTML
- Network tab shows CSS files returning 200 but Content-Type is wrong

**What's actually happening:**
Same root cause as Problem 2—your CSS files are being routed to the SSR function instead of being served from the CDN.

**The fix:**

Verify `force = false` in `netlify.toml`, then:

1. Clear Netlify cache: **Deploys** → **Trigger deploy** → **Clear cache and deploy site**
2. Check Network tab for `styles.xyz789.css`
3. Should show `Content-Type: text/css` and be served from Netlify (not your function)

### Problem 4: Users Get Logged Out on Every Page Refresh

**What you see:**
- User logs in successfully
- User navigates around the app
- Everything works fine
- User refreshes the page (F5)
- Instantly redirected to `/login`
- httpOnly cookie is still in browser (you can see it in DevTools → Application)

**What's actually happening:**
Your `APP_INITIALIZER` is running during server-side rendering and trying to validate the auth token. But httpOnly cookies aren't accessible to server-side JavaScript, so the auth check fails and redirects to login before the client code runs.

**The fix:**

Verify your `app.config.ts` has the platform check:
```typescript
if (!isPlatformBrowser(platformId)) {
  return Promise.resolve();
}
```

### Problem: Build Succeeds but No Content

**Cause:** `index.server.html` not created

**Fix:** Verify `scripts/copy-index.js` runs in build script:
```json
{
  "build:ssr": "ng build --configuration production && ng run frontend:server:production && node scripts/copy-index.js && node scripts/stage-ssr-assets.mjs"
}
```

### Problem: Function Error in Netlify Logs

**Cause:** Server bundle not found or import failed

**Fix:** Check Netlify function logs for specific error. Verify `.ssr-assets` folder staged correctly.

---

## Success Checklist

- [ ] `app.config.ts` skips auth during SSR with `isPlatformBrowser()`
- [ ] `angular.json` has `"ssr": true` in production config
- [ ] `tsconfig.server.json` excludes `server.ts`
- [ ] Build script includes `--configuration production`
- [ ] `scripts/copy-index.js` and `scripts/stage-ssr-assets.mjs` exist and run
- [ ] `netlify/functions/ssr.ts` handles both ESM and CommonJS bundles
- [ ] `netlify.toml` has `force = false` in redirect
- [ ] `netlify.toml` in project root, not `frontend/`
- [ ] Netlify dashboard settings cleared
- [ ] Local test: `npm run build:ssr` succeeds
- [ ] Deployment: Page source shows rendered HTML
- [ ] Static assets load from CDN (not function)
- [ ] Auth works after page refresh

---

## Next Steps

With SSR deployed, consider:
- **Add monitoring** (Sentry for SSR errors)
- **Set up preview deploys** for pull requests
- **Configure custom domain** with SSL
- **Add performance tracking** (Core Web Vitals)
- **Implement prerendering** for static marketing pages
- **Add service worker** for offline support

---

> **Deploy Angular SSR to Netlify Without the Guesswork**  
> If you’d rather not reinvent this whole Angular 20 SSR + Netlify + httpOnly cookie setup, **StackInsight Auth Pro** ships with a working configuration out of the box — including serverless SSR, auth-safe routing, and production-ready build scripts.  
> See what’s included at [stackinsight.app](https://stackinsight.app)

**Questions or feedback?** Reach out via [contact form](https://stackinsight.dev/contact) or [@stackinsightDev](https://x.com/StackInsightDev)

---

*This guide reflects the actual working implementation deployed at production. All configurations tested with Angular 20.2, Node 20, and Netlify's current deployment model.*
