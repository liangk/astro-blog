---
title: "Angular 20 SSR Local Development: Testing SSR the Right Way"
pubDate: "2025-11-10"
heroImage: '../../assets/angular-ssr-local-development.webp'
author: "Ko-Hsin Liang"
categories: ["Angular", "SSR", "Development", "Express", "Authentication"]
repo: ""
description: "How to actually test Angular 20 SSR locally without lying to yourself. Set up true server-side rendering with Express, API proxy, and development configs that mirror production."
metaDescription: "Complete Angular 20 SSR local development setup with Express server, API proxy configuration, and disk-based builds. Test real SSR behavior locally before deploying to production."
keywords: ["angular ssr local development", "angular express server", "ssr development setup", "angular api proxy", "testing ssr locally", "angular disk builds", "ng serve vs ssr", "angular development environment"]
ogTitle: "Angular 20 SSR Local Development: Stop Faking It with ng serve"
ogDescription: "Set up true Angular SSR local development with Express server and API proxy. Test the same code path that runs in production, not in-memory dev server magic."
ogImage: "/assets/angular-ssr-local-development.webp"
ogType: "article"
twitterCard: "summary_large_image"
twitterCreator: "@stackinsightDev"
section: "Development"
tags: ["Angular", "SSR", "Express", "Development", "Local Setup", "API Proxy", "httpOnly Cookies", "Server-Side Rendering", "Testing"]
readTime: 25
wordCount: 5800
canonicalUrl: "https://stackinsight.dev/blog/angular-ssr-local-development"
---

# Angular 20 SSR Local Development: Testing SSR the Right Way

*How to actually test SSR locally without lying to yourself about what's working*

**Last updated**: November 2025 | Angular 20.2+ | Node.js 20

> 💡 **Note**: This guide is based on production implementations. For a complete, production-ready Angular SSR authentication boilerplate, check out [StackInsight Auth Pro](https://stackinsight.app).

---

## The Local Development Dilemma

**The promise**: Run `ng serve` and develop your Angular SSR app locally with hot reload and instant feedback.

**The harsh reality**: `ng serve` doesn't run true SSR. It's a dev server that compiles in-memory and serves your app client-side. So you build features, test them locally, deploy to Netlify, and discover:

- Your httpOnly cookie authentication doesn't work
- Platform-specific code crashes the server
- Meta tags that looked fine locally aren't being set
- The whole "SSR" thing you thought you tested? Wasn't actually running.

I learned this the hard way after spending a weekend debugging "SSR issues" that only appeared in production. Turns out, I was never testing SSR locally.

Here's the thing: if you want to develop with SSR, you need to actually RUN SSR locally. Not simulate it. Not assume it works. Actually execute your Angular app on a Node.js server and see what breaks.

This guide shows you how to set up a local development environment that mirrors your production SSR deployment—so when you test locally, you're testing the same code path that runs on Netlify.

### What You're Actually Building

By the end of this guide, you'll have:
- ✅ **True server-side rendering running locally** (not `ng serve` magic)
- ✅ **Express server with API proxy** forwarding requests to your backend
- ✅ **Development environment configuration** that swaps in local API URLs
- ✅ **Disk-based builds** you can inspect and debug
- ✅ **Platform-aware authentication** that works the same locally and in production
- ✅ **Understanding of what's actually happening** when your code runs

### The Three Development Modes (And When to Use Each)

You'll end up with three different ways to run your app locally. Here's when to use each:

```
┌─────────────────────────────────────────────────────────────────────┐
│  MODE 1: Standard Dev Server (npm start)                           │
├─────────────────────────────────────────────────────────────────────┤
│  Command:    ng serve                                               │
│  Runs:       Angular dev server (in-memory compilation)             │
│  SSR:        ❌ No (client-side only)                               │
│  Speed:      ⚡ Fast (hot reload, instant)                          │
│  Use for:    UI work, styling, component development               │
│  When:       "I'm tweaking a button and want instant feedback"     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  MODE 2: Local SSR Dev (npm run start:ssr:dev) ⭐ THIS GUIDE      │
├─────────────────────────────────────────────────────────────────────┤
│  Command:    npm run start:ssr:dev                                  │
│  Runs:       Disk build → Express server → API proxy               │
│  SSR:        ✅ Yes (true server-side rendering)                    │
│  Speed:      🐢 Slower (~15 second rebuilds)                        │
│  Use for:    Testing SSR, auth flows, server-side logic            │
│  When:       "I need to verify this works in production"           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  MODE 3: Production Build (npm run build:ssr)                      │
├─────────────────────────────────────────────────────────────────────┤
│  Command:    npm run build:ssr                                      │
│  Runs:       Optimized production build (minified, tree-shaken)    │
│  SSR:        ✅ Yes (production bundles)                            │
│  Speed:      🐌 Slowest (~20+ second builds)                        │
│  Use for:    Pre-deployment verification, final testing            │
│  When:       "About to deploy, let me check everything one last    │
│              time with the exact code that will run on Netlify"    │
└─────────────────────────────────────────────────────────────────────┘
```

**The key insight**: Don't use Mode 1 to test SSR features. Use Mode 2. That's what this guide sets up.

**The workflow**:
- Day-to-day UI work → Mode 1 (`npm start`)
- Testing SSR features → Mode 2 (`npm run start:ssr:dev`)
- Before deploying → Mode 3 (`npm run build:ssr`) + manual testing

### Why `ng serve` Can't Test SSR

Let's be clear about what `ng serve` does:

1. Compiles your Angular app in-memory (nothing written to disk)
2. Serves it from a dev server at `localhost:4200`
3. Watches for file changes and hot-reloads
4. Runs entirely client-side (everything renders in the browser)

**What it doesn't do:**
- Execute your code on a Node.js server
- Render components to HTML on the server
- Test httpOnly cookie authentication (cookies work differently in-browser vs server)
- Validate platform-specific code (browser vs server)
- Simulate the Netlify serverless environment

**The result:** Features that "work" in `ng serve` fail in production SSR.

### Our Solution: Real SSR Locally

We're going to:
1. Build your Angular app to disk (browser and server bundles)
2. Run an Express server that loads the server bundle
3. Configure an API proxy (so `/api` goes to your local backend)
4. Use development environment configs (local API URLs, not production)
5. Test the EXACT code path that runs on Netlify

Yes, it's slower than `ng serve`. But it's honest. And honesty in development saves you hours of production debugging.

Let's build it.

---

## Prerequisites

### Required Tools
```bash
node --version    # v20.x or higher
ng version        # Angular CLI 20.x
npm --version     # 10.x or higher
```

### Backend Setup
- Backend API running on `localhost:4000`
- Endpoints available at `http://localhost:4000/api/*`

### Install Dependencies
```bash
cd frontend
npm install

# Required for SSR local dev
npm install --save-dev cross-env ts-node
```

---

## Understanding Angular SSR Builders

### Evolution of Angular SSR

**Angular Universal (Legacy)**
- `@angular-devkit/build-angular:server` builder
- NgModule-based
- CommonJS output (`.js`)
- `CommonEngine` with `renderModule()`

**Angular 17-20 (Modern)**
- `@angular-devkit/build-angular:application` builder
- Standalone components
- ESM output (`.mjs`)
- `renderApplication()` API

### Our Hybrid Approach

We use **both** builders for maximum reliability:

**Production (Netlify):**
- Modern `application` builder with `"ssr": true`
- Generates `main.server.mjs` (ESM)
- Optimized bundles

**Development (Local):**
- Deprecated `server` builder
- Generates `main.js` (CommonJS)
- Reliable disk builds
- Easier debugging

**Why?** The modern builder's dev mode doesn't always generate reliable server bundles in Angular 20.2.2. The deprecated builder works consistently.

### Build Output Structure

After `npm run build:ssr:dev`:

```
dist/frontend/
├── browser/
│   ├── index.html         # Built with injected <link> and <script>
│   ├── index.csr.html     # CSR fallback copy
│   ├── main.js            # App bundle
│   ├── styles.css         # Compiled styles
│   └── assets/
└── server/
    ├── main.js            # CommonJS server bundle
    ├── index.server.html  # Copy of browser/index.html
    └── *.js               # Lazy-loaded chunks
```

---

## Project Structure

```
frontend/
├── src/
│   ├── main.ts                    # Browser entry point
│   ├── main.server.ts             # Server entry point
│   ├── app/
│   │   ├── app.config.ts          # Client config with APP_INITIALIZER
│   │   └── app.config.server.ts   # Server config
│   └── environments/
│       ├── environment.ts                # Production config
│       └── environment.development.ts    # Development config
├── server.ts                       # Express SSR server
├── angular.json                    # Build configuration
├── tsconfig.json                   # Base TypeScript config
├── tsconfig.app.json              # Client TypeScript config
├── tsconfig.server.json           # Server TypeScript config
├── package.json                    # Scripts and dependencies
└── scripts/
    └── copy-index.js              # Post-build script
```

---

## Configuration Files

### angular.json Configuration

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
              "server": "src/main.server.ts",
              "ssr": true,
              "optimization": true,
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "sourceMap": true,
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.development.ts"
                }
              ]
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
            "development": {
              "optimization": false,
              "sourceMap": true,
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.development.ts"
                }
              ]
            }
          },
          "defaultConfiguration": "production"
        }
      }
    }
  }
}
```

**Key Points:**
- `fileReplacements` in development config swaps environment files
- Separate `server` target ensures reliable CommonJS bundles
- `main` points to `src/main.server.ts`, NOT `server.ts`

### TypeScript Configurations

**tsconfig.server.json** - Angular server code only:
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

**tsconfig.app.json** - Client code only:
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

**Critical:** `server.ts` must be excluded from both configs. It's Express code, not Angular code.

---

## Environment Setup (The Secret Sauce for Local vs. Production)

Here's a common mistake: hardcoding API URLs. You end up with code like this scattered everywhere:

```typescript
// DON'T DO THIS
const apiUrl = 'https://api.yourdomain.app/api';
```

Then when you want to test locally, you comment it out and add:

```typescript
// const apiUrl = 'https://api.yourdomain.app/api';  // Prod
const apiUrl = '/api';  // Local
```

And you inevitably commit the commented-out version to prod. We've all been there.

**The right way:** Environment files that Angular swaps automatically based on your build configuration.

### Production Environment (src/environments/environment.ts)
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.yourdomain.app/api',  // Your actual backend
  turnstileSiteKey: 'your-turnstile-site-key'    // Production key
};
```

### Development Environment (src/environments/environment.development.ts)
```typescript
export const environment = {
  production: false,
  ssr: false,  // Optional flag for dev-specific logic
  apiUrl: '/api',  // This gets proxied to localhost:4000
  turnstileSiteKey: 'your-turnstile-site-key'  // Same or test key
};
```

### How the Magic Works

When you run `ng build --configuration development`:

1. Angular looks at `angular.json` and finds the `development` configuration
2. It sees `fileReplacements` that says: \"Replace `environment.ts` with `environment.development.ts`\"
3. During the build, anywhere you import from `environment.ts`, you actually get `environment.development.ts`
4. The final bundle has `/api` as the apiUrl (local)

When you run `ng build --configuration production`:

1. No `fileReplacements` happens (production is the default)
2. You get the actual `environment.ts` file
3. The final bundle has `https://api.yourdomain.app/api` (production)

**The beauty:** Your service code stays the same:

```typescript
import { environment } from '../../environments/environment';

@Injectable()
export class AuthService {
  private base = environment.apiUrl + '/auth';
  // In dev build: '/api/auth' → Proxied to localhost:4000/api/auth
  // In prod build: 'https://api.yourdomain.app/api/auth' → Direct call
}
```

No if statements. No comments to toggle. No accidentally deploying local URLs to production.

**Pro tip:** Check what actually got built:
```bash
# After building in dev mode
grep \"apiUrl\" dist/frontend/browser/main.js
# Should show: apiUrl:\"/api\"

# After building in production mode  
grep \"apiUrl\" dist/frontend/browser/main.js
# Should show: apiUrl:\"https://api.yourdomain.app/api\"
```

---

## Express Server Setup

### Server Entry Point (src/main.server.ts)
```typescript
import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => 
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;
```

**Key:** Exports default bootstrap function that takes `BootstrapContext`.

### Server Config (src/app/app.config.server.ts)
```typescript
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering()
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
```

### Express Wrapper (server.ts)

This is the heart of local SSR development:

```typescript
import 'zone.js/node';
import '@angular/compiler';  // CRITICAL: Must be first!
import { APP_BASE_HREF } from '@angular/common';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function app(): Promise<Express> {
  const server = express();

  const distFolder = resolve(__dirname, 'dist/frontend');
  const browserDistFolder = join(distFolder, 'browser');
  const serverDistFolder = join(distFolder, 'server');
  const indexHtml = join(browserDistFolder, 'index.html');

  // Import server bundle (CommonJS)
  const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.js')).href;
  const serverModule = await import(serverBundlePath);
  
  // Extract renderApplication and bootstrap
  const { renderApplication } = serverModule.default;
  const bootstrap = serverModule.default.default;

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // Proxy /api requests to backend server (localhost:4000)
  server.use('/api', (req: Request, res: Response) => {
    const targetPath = `/api${req.url}`;
    console.log(`[PROXY] ${req.method} ${targetPath} → http://localhost:4000`);
    
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: targetPath,
      method: req.method,
      headers: req.headers
    };

    const proxyReq = httpRequest(options, (proxyRes) => {
      console.log(`[PROXY] Response: ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[PROXY] Error:', err);
      res.status(500).json({ error: 'Proxy error' });
    });

    req.pipe(proxyReq);
  });

  // Health check
  server.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static files (NO caching in development)
  server.get('*.*', express.static(browserDistFolder, {
    maxAge: 0,
    etag: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  // SSR for all other routes
  server.get('*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { protocol, originalUrl, baseUrl, headers } = req;
      const url = `${protocol}://${headers.host}${originalUrl}`;

      // Read index.html template
      const document = await import('fs').then(fs => 
        fs.promises.readFile(indexHtml, 'utf-8')
      );

      // Render using the server bundle's renderApplication
      const html = await renderApplication(bootstrap, {
        document,
        url,
        platformProviders: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
      });
      
      res.send(html);
    } catch (err: unknown) {
      console.error('SSR rendering error:', err);
      next(err);
    }
  });

  return server;
}

async function run(): Promise<void> {
  const port = process.env['PORT'] || 4200;
  const server = await app();
  
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

// Only run if not in serverless environment
if (!process.env.NETLIFY && !process.env.VERCEL) {
  run().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
```

**Critical Details:**

1. **Import order**: `@angular/compiler` must be imported before any Angular code (prevents JIT compilation errors)
2. **Path conversion**: Use `pathToFileURL()` for Windows compatibility
3. **Nested exports**: Bootstrap function is at `serverModule.default.default`
4. **renderApplication**: Use the function from server bundle (not `CommonEngine`)
5. **No caching**: Disabled to prevent stale bundle issues during development
6. **API proxy**: Native Node.js HTTP proxy (Angular's proxy.conf.json doesn't apply to custom servers)

---

## Build Scripts

### Package.json Scripts

```json
{
  "scripts": {
    "comment1": "=== LOCAL CSR (no SSR) ===",
    "start": "ng serve --configuration development --proxy-config proxy.conf.json",
    
    "comment2": "=== LOCAL SSR ===",
    "start:ssr:dev": "npm run build:ssr:dev && cross-env PORT=4200 ts-node --esm server.ts",
    "build:ssr:dev": "ng build --configuration development && ng run frontend:server:development && node scripts/copy-index.js",
    
    "comment3": "=== Netlify SSR ===",
    "build:ssr": "ng build --configuration production && ng run frontend:server:production && node scripts/copy-index.js && node scripts/stage-ssr-assets.mjs"
  }
}
```

**Build Flow:**

`npm run start:ssr:dev` executes:
1. `ng build --configuration development` → Browser bundles with dev environment
2. `ng run frontend:server:development` → Server bundle with dev environment
3. `node scripts/copy-index.js` → Copy built index.html to server folder
4. `cross-env PORT=4200 ts-node --esm server.ts` → Start Express server on port 4200

### Copy Index Script (scripts/copy-index.js)

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

**Why this matters:**

The Angular build injects `<link>` and `<script>` tags into `index.html`:

```html
<!-- Before build (src/index.html) -->
<head>
  <title>My App</title>
</head>

<!-- After build (dist/frontend/browser/index.html) -->
<head>
  <title>My App</title>
  <link rel="stylesheet" href="styles.css">  <!-- INJECTED -->
  <script src="polyfills.js" type="module"></script>  <!-- INJECTED -->
  <script src="main.js" type="module"></script>  <!-- INJECTED -->
</head>
```

We must use the **built** version with these injections, not the raw source file. Otherwise styles and scripts won't load.

---

## API Proxy Configuration (Why You Can't Use proxy.conf.json)

### The Problem with Angular's Built-in Proxy

If you've used `ng serve` before, you might have a `proxy.conf.json` file that looks like this:

```json
{
  "/api": {
    "target": "http://localhost:4000",
    "secure": false
  }
}
```

And you run it with:
```bash
ng serve --proxy-config proxy.conf.json
```

**This works great with `ng serve`.** But here's the catch: it ONLY works with `ng serve`. 

When you run a custom Express server (like we're doing for SSR), Angular's dev server isn't running. So `proxy.conf.json` is completely ignored. Your `/api` requests go nowhere.

**What happens:**
1. Your frontend makes a request to `/api/auth/profile`
2. Express looks for a route handler for `/api/auth/profile`
3. Doesn't find one (you only have the SSR catch-all route)
4. Returns your Angular app HTML as the response
5. Frontend tries to parse HTML as JSON → error

**The solution:** Implement the proxy yourself in the Express server using Node.js's built-in `http` module.

### Manual Proxy Implementation

The Express server includes a native Node.js HTTP proxy (no dependencies needed):

```typescript
server.use('/api', (req: Request, res: Response) => {
  const targetPath = `/api${req.url}`;
  console.log(`[PROXY] ${req.method} ${targetPath} → http://localhost:4000`);
  
  const options = {
    hostname: 'localhost',
    port: 4000,
    path: targetPath,
    method: req.method,
    headers: req.headers  // Forward all headers (including cookies!)
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    console.log(`[PROXY] Response: ${proxyRes.statusCode}`);
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[PROXY] Error:', err);
    res.status(500).json({ error: 'Proxy error' });
  });

  req.pipe(proxyReq);
});
```

**How it works:**
- Request to `http://localhost:4200/api/auth/profile`
- Proxy forwards to `http://localhost:4000/api/auth/profile`
- Response piped back to client
- Cookies preserved in both directions

### Verification

```bash
# Terminal 1: Start backend
cd backend
npm start  # Should run on port 4000

# Terminal 2: Start SSR dev server
cd frontend
npm run start:ssr:dev  # Should run on port 4200

# Test proxy
curl http://localhost:4200/api/auth/profile
# Should see [PROXY] logs and get response from backend
```

---

## Running and Testing

### Step 1: Start Backend

```bash
cd backend
npm start
# Backend should run on localhost:4000
```

### Step 2: Build and Start SSR Server

```bash
cd frontend

# Build browser + server bundles, then start Express
npm run start:ssr:dev

# You should see:
# ✓ Synced built index template to server/index.server.html
# Node Express server listening on http://localhost:4200
```

### Step 3: Verify SSR is Working

**Test 1: View Page Source**
1. Open http://localhost:4200
2. Right-click → "View Page Source" (Ctrl+U / Cmd+U)
3. **✅ Success:** Full HTML content inside `<app-root>`
4. **❌ Failure:** Empty `<app-root></app-root>`

**Test 2: Check Styles Load**
1. Open http://localhost:4200
2. Page should be fully styled (not unstyled HTML)
3. Open DevTools → Network tab
4. **✅ Success:** `styles.css` loads with 200 status
5. **❌ Failure:** 404 or missing styles

**Test 3: Test API Proxy**
1. Open DevTools → Console
2. Try logging in or making API calls
3. Check terminal where Express is running
4. **✅ Success:** See `[PROXY] GET /api/auth/profile → http://localhost:4000` logs
5. **❌ Failure:** No proxy logs or connection errors

**Test 4: Verify Environment**
```bash
# Check that development environment is used
grep "apiUrl" dist/frontend/browser/main.js
# Should show: apiUrl:"/api" (not production URL)
```

**Test 5: Test Auth Flow**
1. Navigate to protected route (e.g., `/dashboard`)
2. If not logged in, should redirect to `/login`
3. Log in with credentials
4. Should redirect back to `/dashboard`
5. Refresh page (F5)
6. **✅ Success:** Stay on `/dashboard` (no login flash)
7. **❌ Failure:** Kicked to `/login`

### Step 4: Test Hot-Reload Workflow

SSR doesn't have true hot-reload, but you can rebuild quickly:

```bash
# Make a code change in src/

# Rebuild (Ctrl+C to stop server first)
npm run start:ssr:dev

# Or just rebuild without restarting:
npm run build:ssr:dev
# Then refresh browser (server doesn't need restart)
```

---

## Common Pitfalls

### Pitfall 1: Port 4200 Already in Use

**Problem:** Server won't start, port conflict

**Fix:**
```bash
# Windows
netstat -ano | findstr :4200
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:4200 | xargs kill -9

# Or use different port
cross-env PORT=4200 ts-node --esm server.ts
```

### Pitfall 2: Module Not Found Error

**Problem:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'main.js'
```

**Fix:**
1. Verify build completed:
   ```bash
   ls dist/frontend/server/main.js
   ```
2. If missing, run build manually:
   ```bash
   ng run frontend:server:development
   ```

### Pitfall 3: JIT Compilation Error

**Problem:**
```
The injectable 'PlatformLocation' needs to be compiled using the JIT compiler, 
but '@angular/compiler' is not available
```

**Fix:** Verify `server.ts` imports `@angular/compiler` **first**:
```typescript
import 'zone.js/node';
import '@angular/compiler';  // ← Must be here!
import { APP_BASE_HREF } from '@angular/common';
```

### Pitfall 4: Styles Not Loading

**Problem:** Page renders but has no styles

**Cause:** Using raw `src/index.html` instead of built version

**Fix:** Verify `scripts/copy-index.js` runs and copies from `dist/frontend/browser/index.html`

### Pitfall 5: Browser Caching Old Bundle

**Problem:** Code changes don't appear even after rebuild

**Fix:** Hard refresh browser:
- Windows/Linux: `Ctrl + Shift + R` or `Ctrl + F5`
- Mac: `Cmd + Shift + R`
- Or: DevTools → Network → "Disable cache" → Refresh

### Pitfall 6: Wrong Environment Variables

**Problem:** API requests go to production URL instead of `/api`

**Fix:** Verify `fileReplacements` in angular.json and check built bundle:
```bash
grep "apiUrl" dist/frontend/browser/main.js
# Should show: apiUrl:"/api"
```

### Pitfall 7: Proxy Not Working

**Problem:** API requests fail with connection refused

**Fix:**
1. Verify backend is running on port 4000
2. Check Express logs show `[PROXY]` messages
3. Verify environment uses `apiUrl: '/api'`

### Pitfall 8: Windows Path Errors

**Problem:**
```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only file and data URLs are supported
```

**Fix:** Use `pathToFileURL()` for module imports:
```typescript
import { pathToFileURL } from 'node:url';
const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.js')).href;
```

---

## Troubleshooting

### Issue: Server Crashes on Startup

**Symptoms:** Express server starts then immediately crashes

**Diagnosis:**
```bash
# Run with verbose error logging
node --trace-warnings dist/frontend/server.js
```

**Common causes:**
- Missing dependencies (`npm install`)
- Server bundle not built (`npm run build:ssr:dev`)
- Port already in use
- Import path errors

### Issue: SSR Not Rendering (Empty <app-root>)

**Symptoms:** Page source shows `<app-root></app-root>` with no content

**Diagnosis:**
1. Check Express terminal for errors
2. Look for "SSR rendering error:" messages
3. Check browser console for errors

**Common causes:**
- `renderApplication()` not imported correctly
- Bootstrap function not found
- Platform-specific code running on server

**Fix:** Add SSR guards:
```typescript
if (isPlatformBrowser(this.platformId)) {
  // Browser-only code
}
```

### Issue: API Calls Fail

**Symptoms:** 404 or connection refused on `/api` requests

**Diagnosis:**
1. Check backend is running: `curl http://localhost:4000/health`
2. Check proxy logs in Express terminal
3. Verify environment: `console.log(environment.apiUrl)`

**Fix:**
- Ensure backend runs on port 4000
- Verify `apiUrl: '/api'` in development environment
- Check proxy middleware is before SSR route handler

### Issue: Authentication Doesn't Work

**Symptoms:** Always redirected to login, even after successful auth

**Diagnosis:**
1. Check browser Network tab → Headers
2. Verify `Set-Cookie` header in login response
3. Check subsequent requests include `Cookie` header

**Common causes:**
- `withCredentials: true` missing in HTTP interceptor
- httpOnly cookies blocked by browser settings
- AUTH check running during SSR (should be skipped)

**Fix:** Verify `app.config.ts` skips auth during SSR:
```typescript
if (!isPlatformBrowser(platformId)) {
  return Promise.resolve();
}
```

### Issue: Build Succeeds But Old Code Runs

**Symptoms:** Changes don't appear after rebuild

**Cause:** Browser cache or server didn't reload bundle

**Fix:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Restart Express server (Ctrl+C then `npm run start:ssr:dev`)
3. Clear dist folder: `rm -rf dist && npm run build:ssr:dev`

### Issue: TypeScript Compilation Errors

**Symptoms:**
```
error TS2307: Cannot find module 'express' or its corresponding type declarations
```

**Cause:** `server.ts` included in Angular TypeScript compilation

**Fix:** Verify `tsconfig.app.json` and `tsconfig.server.json` both exclude `server.ts`

---

## Performance Tips

### Build Times

- Initial build: 15-20 seconds
- Incremental rebuild: 10-15 seconds
- Consider using `--watch` mode for faster iterations (experimental)

### Bundle Sizes

**Development builds:**
- Browser: ~4.9 MB (unoptimized)
- Server: ~8.5 MB (includes all dependencies)

This is normal for dev. Production builds are much smaller (see Part 1).

### Memory Usage

- Node.js process: ~200-300 MB
- If memory issues occur, increase Node heap:
  ```bash
  cross-env NODE_OPTIONS="--max-old-space-size=4096" npm run start:ssr:dev
  ```

---

## Quick Reference

### Start SSR Dev Server
```bash
cd frontend
npm run start:ssr:dev
# Opens on http://localhost:4200
```

### Rebuild Only (Without Restarting Server)
```bash
npm run build:ssr:dev
# Then refresh browser
```

### Verify Environment
```bash
grep "apiUrl" dist/frontend/browser/main.js
# Should show: apiUrl:"/api"
```

### Clear Everything and Rebuild
```bash
rm -rf dist node_modules/.cache
npm run build:ssr:dev
```

### Test Proxy
```bash
curl http://localhost:4200/api/health
# Should forward to backend
```

---

## Success Checklist

- [ ] `cross-env` and `ts-node` installed as dev dependencies
- [ ] `angular.json` has separate `server` target with `fileReplacements`
- [ ] `tsconfig.server.json` excludes `server.ts`
- [ ] `environment.development.ts` has `apiUrl: '/api'`
- [ ] `server.ts` imports `@angular/compiler` before Angular code
- [ ] `server.ts` uses `pathToFileURL()` for module imports
- [ ] `server.ts` includes API proxy middleware
- [ ] `scripts/copy-index.js` copies built `index.html`
- [ ] `package.json` has `start:ssr:dev` and `build:ssr:dev` scripts
- [ ] Backend runs on `localhost:4000`
- [ ] `npm run start:ssr:dev` starts server on `localhost:4200`
- [ ] Page source shows rendered HTML (not empty `<app-root>`)
- [ ] Styles load correctly
- [ ] API proxy works (see `[PROXY]` logs)
- [ ] Authentication works without login flash

---

## Next Steps

With local SSR working, you're ready to:
1. **Test SSR-specific features** (meta tags, canonical URLs)
2. **Debug SSR issues** before deployment
3. **Develop with real backend** (via proxy)
4. **Deploy to Netlify** (see Part 1 guide)

---

## Additional Resources

- **[Angular SSR Guide](https://angular.dev/guide/ssr)** - Official documentation
- **[Express Documentation](https://expressjs.com/)** - Express server API
- **[Node.js ESM](https://nodejs.org/api/esm.html)** - Module resolution
- **[Part 1: Netlify Deployment](./part1_angular_ssr_netlify_deployment.md)** - Deploy to production

---

> **Skip the Boilerplate with StackInsight Auth Pro**  
> If you want this honest SSR dev setup *and* a production-ready auth stack, check out **StackInsight Auth Pro** — a production-ready Angular 20 SSR + httpOnly cookie authentication starter. It packages the patterns from this guide into a ready-to-run project so you can focus on your product, not wiring.  
> Learn more at [stackinsight.app](https://stackinsight.app)

**Questions or feedback?** Reach out via [contact form](https://stackinsight.dev/contact) or [@stackinsightDev](https://x.com/StackInsightDev)

---

*This guide reflects the actual working implementation used in development. All configurations tested with Angular 20.2, Node 20, and Express 4.18.*
