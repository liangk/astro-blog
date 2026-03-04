---
title: "Angular 21 SSR Local Development: What Changed, What Broke, and How to Fix It"
pubDate: "2026-03-04"
heroImage: '../../assets/angular-21-ssr-local-development.webp'
author: "Ko-Hsin Liang"
categories:
  - Angular
  - SSR
  - Development
  - Express
  - Authentication
repo: ""
description: "Angular 21 broke almost every SSR local dev pattern from Angular 20. Here's everything that changed, every error we hit, and the working setup that actually runs SSR on your machine."
metaDescription: "Complete Angular 21 SSR local development guide. New builder, new bundle format, new errors. Learn how CommonEngine replaces renderApplication and why provideServerRendering moved packages."
keywords:
  - angular 21 ssr local development
  - angular 21 express server
  - angular 21 ssr setup
  - angular commonengine ssr
  - angular ssr errors ng0201
  - angular ssr platformdestroylisteners
  - angular build application ssr
  - angular 21 vs angular 20 ssr
  - angularnodeappengine manifest error
  - angular ssr main.server.mjs
ai_summary: "A comprehensive guide for setting up Angular 21 SSR local development with an Express server. Documents every breaking change from Angular 20, explains why AngularNodeAppEngine fails with ts-node, and provides the working CommonEngine approach with full working code."
ai_key_facts:
  - "The modern @angular/build:application builder (Angular 17+) replaces the older dual-builder SSR architecture"
  - "The unified builder produces main.server.mjs (ESM) instead of main.js (CJS) and index.csr.html instead of index.html"
  - "provideServerRendering moved from @angular/platform-server to @angular/ssr in Angular 20"
  - "AngularNodeAppEngine fails when running ts-node from project root due to manifest path resolution"
  - "CommonEngine from @angular/ssr/node is the reliable way to run SSR with a custom Express server"
  - "Bootstrap must be loaded from the compiled main.server.mjs bundle, not from src/"
  - "tsconfig.app.json requires composite: true and must include main.server.ts in its files array"
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Angular 21, Node.js 20, Express 4"
schema_time_required: "PT35M"
ogTitle: "Angular 21 SSR Local Development: What Broke and How to Fix It"
ogDescription: "Angular 21 changed everything about SSR local development. New builder, new bundle format, new errors. Here's the working setup that actually runs true SSR on your machine."
ogImage: "/assets/angular-21-ssr-local-development.webp"
ogType: "article"
twitterCard: "summary_large_image"
twitterCreator: "@stackinsightDev"
section: "Development"
tags:
  - Angular
  - Angular 21
  - SSR
  - Express
  - Development
  - Local Setup
  - API Proxy
  - CommonEngine
  - Server-Side Rendering
  - Breaking Changes
related_posts:
  - angular-ssr-local-development
  - angular-ssr-netlify-deployment
series: "StackInsight Angular SSR Series"
series_order: 2
readTime: 35
wordCount: 7500
canonicalUrl: "https://stackinsight.dev/blog/angular-21-ssr-local-development"
---

# Angular 21 SSR Local Development: What Changed, What Broke, and How to Fix It

*A day of fighting Angular 21's new SSR internals, documented so you don't have to repeat it*

**Last updated**: March 2026 | Angular 21.1.5 | Node.js 20

> 💡 **Note**: This is the Angular 21 follow-up to our [Angular 20 SSR Local Development guide](/blog/angular-ssr-local-development). If you're on Angular 20, read that one first — it covers the fundamentals and the Express + API proxy setup in detail. Come back here when you upgrade and things stop working.

---

## When "It Works in Angular 20" Stops Being True

Here's the scene: you've got a working Angular 20 SSR local dev setup. Express server, `renderApplication`, `main.js` from the server bundle. You run `npm run start:ssr:dev`, it boots up, your app renders server-side, life is good.

Then you upgrade to Angular 21.

Nothing works.

Your `main.js` doesn't exist anymore. Your `renderApplication` import throws `TypeError: renderApplication is not a function`. Your platform providers throw `NG0201: No provider found for InjectionToken PlatformDestroyListeners`. You add `provideServerRendering` to `platformProviders`, you add `PLATFORM_ID`, you import from different packages — and the same error keeps coming back. Then you try `AngularNodeAppEngine` from the docs and get a completely different error: *"Angular app engine manifest is not set."*

That was my experience upgrading this project from Angular 20 to 21. This guide is the documentation I wish had existed.

Angular 21's SSR architecture changed substantially. Not "renamed one function" substantially — *different file format, different import paths, different rendering API, different builder configuration* substantially. The changes are real improvements for production deployments. But if you're trying to maintain a working local dev setup through the upgrade, you need to understand exactly what changed and why.

Let's walk through all of it.

---

## What You're Getting Into

By the end of this guide you'll have:
- ✅ **True Angular 21 SSR running locally** using `CommonEngine` and `main.server.mjs`
- ✅ **A clear understanding of every breaking change** between Angular 20 and 21 SSR, with links to relevant `angular.dev` documentation
- ✅ **Clarity on `AngularNodeAppEngine`** — what it is, why it's exciting, and why it doesn't work for the `ts-node` local dev pattern yet
- ✅ **A working `server.ts`** that loads the new ESM bundle correctly
- ✅ **All the `NG0201` and `NG0401` errors explained** with root causes and fixes
- ✅ **API proxy** forwarding to your local backend

---

## The Big Picture: Legacy vs. Modern Angular SSR

Before touching any code, here's the full comparison of what changed:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│      Older Setup (still works)      │    Recommended Setup (Angular 17+)   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ TWO builders:                        │ ONE builder:                         │
│ - @angular-devkit/build-angular      │ - @angular/build:application         │
│   :application (browser)             │   with ssr: true per configuration   │
│ - @angular-devkit/build-angular      │                                      │
│   :server                            │                                      │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Server bundle: main.js (CommonJS)    │ Server bundle: main.server.mjs (ESM) │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Index file: dist/browser/index.html  │ Index file: dist/browser/index.csr.html│
├──────────────────────────────────────┼──────────────────────────────────────┤
│ renderApplication exported from      │ renderApplication NOT exported       │
│ server bundle — import and call it   │ Use CommonEngine from @angular/ssr   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ provideServerRendering from:         │ provideServerRendering from:         │
│ @angular/platform-server             │ @angular/ssr (different package!)    │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Bootstrap: serverModule.default      │ Bootstrap: serverModule.default      │
│            .default (double-nested)  │ (single .default)                    │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Build needs two commands:            │ Single command builds everything:    │
│ ng build + ng run :server:dev        │ ng build --configuration development │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ tsconfig: composite not needed       │ tsconfig: composite: true required   │
│ server files in separate tsconfig    │ server files IN tsconfig.app.json    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

Eight things differ between the legacy and modern SSR setups. If you're upgrading from an older project still using the deprecated server builder, these changes will affect your configuration. This guide walks through each one.

---

## The Three Development Modes (Same Strategy, Different Wiring)

The fundamental local dev strategy hasn't changed — there are still three ways to run your app, and you need the right one for each situation:

```
┌──────────────────────────────────────────────────────────────────┐
│  MODE 1: Standard Dev Server (npm start)                        │
├──────────────────────────────────────────────────────────────────┤
│  Command: ng serve                                               │
│  SSR:     ❌ No (client-side rendering only, in-memory)          │
│  Speed:   ⚡ Fast — best for UI work and component development   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  MODE 2: Local SSR Dev (npm run start:ssr:dev) ← THIS GUIDE     │
├──────────────────────────────────────────────────────────────────┤
│  Command: npm run start:ssr:dev                                  │
│  SSR:     ✅ Yes — disk build → CommonEngine → Express proxy     │
│  Speed:   🐢 Slower (~20-30s rebuilds)                           │
│  Use for: SSR feature testing, auth flows, meta tags, crawlers  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  MODE 3: Production Build (npm run build:ssr)                   │
├──────────────────────────────────────────────────────────────────┤
│  Command: npm run build:ssr                                      │
│  SSR:     ✅ Yes — optimized production bundles                  │
│  Speed:   🐌 Slowest — run before deploying only                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Understanding Angular 21's New SSR Architecture

### The Builder Unified Into One

**Note:** The unified `@angular/build:application` builder was introduced in Angular 17 and became the recommended default for new projects. If you're still using the older `@angular-devkit/build-angular:server` builder (which still works in Angular 20+), this section explains the differences and migration path.

The older setup uses a separate `@angular-devkit/build-angular:server` builder that produces a CommonJS `main.js` bundling `renderApplication` as an export alongside your bootstrap function. Predictable. Reliable. Slightly clunky.

**The modern approach uses ONE builder** — `@angular/build:application` — with SSR configured inside it per build configuration:

```json
// Angular 21 — one builder, SSR in each configuration
"build": {
  "builder": "@angular/build:application",
  "configurations": {
    "development": {
      "server": "src/main.server.ts",
      "ssr": true,
      "optimization": false,
      "sourceMap": true
    },
    "production": {
      "server": "src/main.server.ts",
      "ssr": true,
      "optimization": true
    }
  }
}
```

> 📖 **[Angular docs — SSR guide](https://angular.dev/guide/ssr)**: The unified `@angular/build:application` builder handles both browser and server bundles in a single build pass. The `"server"` entry point and `"ssr": true` enable server-side rendering for that configuration.

**What this means for your workflow:**
- No more `ng run project:server:development` as a separate build step — `ng build --configuration development` produces both browser and server bundles
- The `build:ssr:dev` npm script gets simpler (and one fewer thing to configure)
- But the output format changes, and everything in `server.ts` that depended on the old format breaks

### The New Bundle: `main.server.mjs` (Not `main.js`)

The old `server` builder produced CommonJS output (`main.js`) — a regular `.js` file you could `require()` or `import()` like any Node module. Crucially, it packaged `renderApplication` into the output alongside your bootstrap function.

Angular 21's unified builder produces an **ES module**: `main.server.mjs`. This file:
- Uses `import`/`export` syntax (not `require`/`module.exports`)
- **Does NOT export `renderApplication`** — it only exports your bootstrap function and some Angular SSR internals
- Must be loaded with dynamic `import()` via a `file://` URL (required on Windows due to ESM URL resolution)

```
// Angular 20 dist structure
dist/frontend/server/
└── main.js                           ← CJS, exports bootstrap + renderApplication

// Angular 21 dist structure
dist/web/server/
├── main.server.mjs                   ← ESM, exports bootstrap only
├── angular-app-manifest.mjs          ← New: consumed by AngularNodeAppEngine
├── angular-app-engine-manifest.mjs   ← New: consumed by AngularNodeAppEngine
├── polyfills.server.mjs
└── chunk-XXXX.mjs
```

Those two new manifest files are worth understanding — they're why `AngularNodeAppEngine` exists and why it doesn't quite work for our use case.

### Why `renderApplication()` No Longer Works

In Angular 20, you imported `renderApplication` directly from the compiled server bundle:

```typescript
// Angular 20 — server bundle exported renderApplication
const serverModule = await import(serverBundlePath);
const { renderApplication } = serverModule.default;  // ← returned a function
const bootstrap = serverModule.default.default;
```

In Angular 21, `serverModule.default.renderApplication` is `undefined`. The function still exists in `@angular/platform-server`, but the new build system doesn't re-export it from your application bundle.

> 📖 **[renderApplication API](https://angular.dev/api/platform-server/renderApplication)**: Still available in `@angular/platform-server`, but Angular 21's `@angular/build:application` no longer packages it into your app's server bundle output. The Angular team's answer is to use `CommonEngine` or `AngularNodeAppEngine` instead.

---

## Meet AngularNodeAppEngine (And Why It Doesn't Work Here)

When you read the Angular 21 SSR docs, `AngularNodeAppEngine` is front and center as the recommended server API:

```typescript
import { AngularNodeAppEngine, writeResponseToNodeResponse } from '@angular/ssr/node';

const angularApp = new AngularNodeAppEngine();

app.use('*', (req, res, next) => {
  angularApp.handle(req)
    .then(response => {
      if (response) writeResponseToNodeResponse(response, res);
      else next();
    })
    .catch(next);
});
```

> 📖 **[AngularNodeAppEngine API](https://angular.dev/api/ssr/node/AngularNodeAppEngine)**: The official Angular 21 API for Node.js SSR servers. Automatically handles manifest loading, route resolution, and platform setup.

This looks clean. No bootstrap loading. No explicit `documentFilePath`. No platform providers. The engine handles everything automatically.

**So why aren't we using it?**

`AngularNodeAppEngine` reads `angular-app-engine-manifest.mjs` at startup to discover your app's entry points and routes. This manifest lives at `dist/web/server/angular-app-engine-manifest.mjs` — generated by the build.

When you run `ts-node --esm server.ts` from your **project root**, `AngularNodeAppEngine` looks for the manifest relative to where Node.js is running — your project root, not `dist/web/server/`. The result is:

```
Error: Angular app engine manifest is not set. Please ensure you are using
the '@angular/build:application' builder to build your server application.
```

The manifest *is* there. The builder *is* `@angular/build:application`. Angular just can't locate the manifest because the server process is running from the wrong directory relative to the dist output.

**Angular CLI's `ng serve`** performs SSR differently — it uses `main.server.ts` directly in-memory and does not go through `AngularNodeAppEngine` or the manifest at all. The manifest-based approach is intended for production Node.js server deployments. When you're running a custom Express server from the project root with `ts-node`, the manifest resolution fails.

`AngularNodeAppEngine` is the right answer for production and for server deployments where the process runs *from* the dist folder. For the `ts-node --esm server.ts` local dev pattern from the project root, `CommonEngine` is the correct tool right now.

---

## The Solution: CommonEngine

`CommonEngine` from `@angular/ssr/node` is the stable, explicitly-controlled rendering engine for Angular in custom Node.js servers. You load your bootstrap function from the compiled bundle and pass everything explicitly:

```typescript
import { CommonEngine } from '@angular/ssr/node';

const commonEngine = new CommonEngine();

commonEngine.render({
  bootstrap,           // Loaded from dist/web/server/main.server.mjs
  documentFilePath,    // Path to dist/web/server/index.server.html
  url,                 // Full request URL
  publicPath,          // Path to dist/web/browser
  providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }]
})
```

> 📖 **[CommonEngine API](https://angular.dev/api/ssr/node/CommonEngine)**: Officially supported for custom Node.js servers. Works regardless of which directory your server process runs from, because you provide all paths explicitly.

---

## Prerequisites

### Tools
```bash
node --version    # v20.x or higher recommended
ng version        # Angular CLI 21.x
```

### Install SSR Dev Dependencies
```bash
cd apps/web
npm install --save-dev cross-env ts-node
```

### Backend
Your local backend should run on `localhost:3000`. (This project uses 3000 instead of the older 4000 — adjust the proxy target in `server.ts` if yours differs.)

---

## Project Structure

```
apps/web/
├── src/
│   ├── main.ts                          # Browser entry point
│   ├── main.server.ts                   # Server entry (MUST accept BootstrapContext)
│   ├── app/
│   │   ├── app.config.ts                # Client app config
│   │   └── app.config.server.ts         # Server config (provideServerRendering from @angular/ssr)
│   └── environments/
│       ├── environment.ts               # Production env
│       └── environment.development.ts   # Dev env (apiUrl: '/api')
├── server.ts                            # Express SSR server (uses CommonEngine)
├── angular.json                         # Single builder with ssr: true in configs
├── tsconfig.json                        # Base TypeScript config
├── tsconfig.app.json                    # composite: true + server files included
├── tsconfig.server.json                 # composite: true
├── package.json
└── scripts/
    └── copy-index.js                    # Post-build: copies index.csr.html → index.server.html
```

---

## Configuration Files

### angular.json — One Builder, SSR in Each Configuration

The entire `"server"` architect target block from Angular 20 is gone. SSR now lives inside the `"build"` target's configurations via the `"server"` and `"ssr"` properties:

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "projects": {
    "web": {
      "projectType": "application",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/web",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "polyfills": ["zone.js"],
            "tsConfig": "tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "assets": [{ "glob": "**/*", "input": "public" }],
            "styles": ["src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "optimization": true,
              "outputHashing": "all",
              "sourceMap": false,
              "extractLicenses": true,
              "namedChunks": false,
              "server": "src/main.server.ts",
              "ssr": true,
              "fileReplacements": [
                { "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.prod.ts" }
              ]
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true,
              "server": "src/main.server.ts",
              "ssr": true,
              "fileReplacements": [
                { "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.development.ts" }
              ]
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": { "buildTarget": "web:build:production" },
            "development": { "buildTarget": "web:build:development" }
          },
          "defaultConfiguration": "development"
        }
      }
    }
  }
}
```

> 📖 **[Angular docs — SSR guide](https://angular.dev/guide/ssr)**: `"server"` points to your `main.server.ts` entry point and `"ssr": true` enables server bundle output. Both must be present in every configuration where you want SSR output — development and production alike.

**Angular 20 comparison**: You needed a separate `"server"` architect target with its own `@angular-devkit/build-angular:server` builder, `tsConfig`, and `outputPath`. In Angular 21, delete the entire `"server"` target — the unified builder handles it.

### tsconfig.app.json — `composite: true` and Server Entry Files

Angular 21 uses TypeScript project references internally. Project references require `"composite": true` in every referenced tsconfig. Without it the build fails with:

```
error TS6306: Referenced project '...tsconfig.app.json' must have setting "composite": true.
```

Also, the unified builder requires your server entry files to be listed in `tsconfig.app.json`'s `files` array — otherwise you'll see warnings about files outside the TypeScript program:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": [],
    "composite": true
  },
  "files": [
    "src/main.ts",
    "src/main.server.ts",
    "src/app/app.config.server.ts"
  ],
  "include": ["src/**/*.d.ts"],
  "exclude": ["server.ts", "src/**/*.spec.ts"]
}
```

**Angular 20 comparison**: Angular 20's `tsconfig.app.json` only listed `src/main.ts` in `files`. Server files lived in the separate `tsconfig.server.json` for the now-removed server builder. Since that builder is gone, server files now belong in `tsconfig.app.json`.

### tsconfig.server.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/server",
    "target": "ES2022",
    "module": "ESNext",
    "types": ["node"],
    "composite": true
  }
}
```

### tsconfig.spec.json

Add `"composite": true` to this one too — otherwise project reference resolution fails:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/spec",
    "types": ["vitest/globals"],
    "composite": true
  }
}
```

---

## Angular Application Files

### src/main.server.ts

The entry point for server-side rendering. The `BootstrapContext` parameter is mandatory — without it you get `NG0401: Missing Platform` because Angular's SSR engine can't inject the server platform context:

```typescript
import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
```

> 📖 **[BootstrapContext API](https://angular.dev/api/platform-browser/BootstrapContext)**: The context object Angular's server engine passes to `bootstrapApplication` during SSR. Contains platform-level providers including the request URL, document, and server-side platform tokens. Without it, those providers can't be injected into your application tree.

This file is essentially the same between Angular 20 and 21. If your Angular 20 project already used `BootstrapContext`, no changes are needed.

### src/app/app.config.server.ts — The Import That Breaks Everything

This is where most Angular 21 SSR migrations fail. The `provideServerRendering` function **moved packages**:

```typescript
// ❌ Pre-Angular 20 import — causes NG0201 PlatformDestroyListeners error
import { provideServerRendering } from '@angular/platform-server';

// ✅ Angular 20+ correct import
import { provideServerRendering } from '@angular/ssr';
```

The function name and call signature are identical. Only the package changed. But using the old `@angular/platform-server` import results in this cryptic error:

```
NG0201: No provider found for `InjectionToken PlatformDestroyListeners`.
Source: Platform: core.
```

The reason: `@angular/ssr`'s `provideServerRendering` registers the complete Angular 21 server platform provider chain, including `PlatformDestroyListeners`. The `@angular/platform-server` version no longer does this in Angular 21 — it's either been stripped down or is incompatible with Angular 21's revised platform internals.

#### Basic Configuration (Minimal Setup)

```typescript
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/ssr';  // NOT @angular/platform-server
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering()
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
```

> 📖 **[provideServerRendering API](https://angular.dev/api/ssr/provideServerRendering)**: Moved to `@angular/ssr` in Angular 20. Configures server-side rendering including support for server routes, app shell, transfer state, and all internal server platform tokens.

#### Advanced Configuration: Hybrid Rendering with Server Routes

While the basic setup works, `provideServerRendering()` accepts optional feature parameters that give you fine-grained control over how each route is rendered. This is called **hybrid rendering** — mixing SSR, prerendering (SSG), and client-side rendering based on route requirements.

**Why configure server routes?**

Without `withRoutes()`, Angular uses default behavior:
- All parametrized routes → SSR
- All non-parametrized routes → Prerendered (SSG)

For applications with auth, dashboards, and public pages, you should explicitly configure rendering modes for optimal performance and security.

**Step 1: Create `src/app/app.routes.server.ts`**

```typescript
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public pages - prerendered for SEO and performance
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'about', renderMode: RenderMode.Prerender },
  { path: 'terms', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  
  // Auth pages - client-side only
  { path: 'login', renderMode: RenderMode.Client },
  { path: 'register', renderMode: RenderMode.Client },
  { path: 'forgot-password', renderMode: RenderMode.Client },
  
  // Protected routes - server-rendered for user-specific data
  { path: 'dashboard', renderMode: RenderMode.Server },
  { path: 'settings', renderMode: RenderMode.Server },
  
  // Fallback
  { path: '**', renderMode: RenderMode.Server }
];
```

> 📖 **[ServerRoute API](https://angular.dev/api/ssr/ServerRoute)**: Defines rendering strategy per route. Three modes available:
> - `RenderMode.Prerender` (SSG): Static HTML generated at build time
> - `RenderMode.Server` (SSR): Rendered on-demand per request
> - `RenderMode.Client` (CSR): Server sends shell, browser renders everything

**Step 2: Update `app.config.server.ts` to use `withRoutes`**

```typescript
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes))
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
```

> 📖 **[withRoutes API](https://angular.dev/api/ssr/withRoutes)**: Configures server-side routing for the application. Registers an array of `ServerRoute` definitions, enabling per-route rendering strategies.

**Step 3: Add `app.routes.server.ts` to TypeScript compilation**

Update `tsconfig.app.json` to include the new server routes file:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": [],
    "composite": true
  },
  "files": [
    "src/main.ts",
    "src/main.server.ts",
    "src/app/app.config.server.ts",
    "src/app/app.routes.server.ts"
  ],
  "include": ["src/**/*.d.ts"],
  "exclude": ["server.ts", "src/**/*.spec.ts"]
}
```

**Benefits of this approach:**

1. **Performance** — Static pages load instantly (prerendered)
2. **SEO** — Public pages fully indexed by search engines
3. **Security** — Auth pages don't expose server logic
4. **Efficiency** — Only dynamic pages use server resources
5. **User Experience** — Optimal rendering strategy per route type

**Understanding the render modes:**

- **`RenderMode.Prerender`**: HTML generated once at build time and served as static files. Best for content that rarely changes (landing pages, about, terms).
- **`RenderMode.Server`**: HTML rendered on every request. Use for user-specific or frequently changing content (dashboards, user profiles).
- **`RenderMode.Client`**: Server sends minimal shell; browser renders everything. Use for auth flows or pages that shouldn't be server-rendered.

> 💡 **Note**: Your client-side routes (`app.routes.ts`) remain unchanged. The `app.routes.server.ts` file only controls *how* each route is rendered, not the route structure itself.

---

## Build Output Structure

After `ng build --configuration development`, the dist folder looks like this:

```
dist/web/
├── browser/
│   ├── index.csr.html          ← NEW name (was index.html in Angular 20)
│   ├── main.js                 # Browser app bundle
│   ├── styles.css
│   └── assets/
└── server/
    ├── main.server.mjs         ← NEW name and format (was main.js CJS in Angular 20)
    ├── polyfills.server.mjs
    ├── angular-app-manifest.mjs
    ├── angular-app-engine-manifest.mjs
    ├── index.server.html       ← Copied here by scripts/copy-index.js
    └── chunk-XXXX.mjs
```

Two filename changes to be aware of:
1. **`index.html` → `index.csr.html`**: The `application` builder names the browser fallback HTML this way. CSR = Client-Side Rendering. The name distinguishes the un-rendered HTML template from any server-rendered output. Your `copy-index.js` script must handle this new name.
2. **`main.js` → `main.server.mjs`**: The server bundle is ESM. The `.mjs` extension makes this explicit and is required for correct Node.js module resolution.

### Environment Files (Same Pattern, No Changes Needed)

```typescript
// src/environments/environment.development.ts
export const environment = {
  production: false,
  apiUrl: '/api',  // Proxied to local backend by Express
};
```

```typescript
// src/environments/environment.ts (production)
export const environment = {
  production: true,
  apiUrl: 'https://api.yourdomain.app/api',
};
```

Verify the dev build uses `/api` before starting the server:
```bash
grep "apiUrl" dist/web/browser/main.js
# Should show: apiUrl:"/api"
```

---

## Express Server Setup (server.ts)

This is the most heavily changed file compared to Angular 20. Here's the complete working version, followed by a line-by-line breakdown of every change:

```typescript
import 'zone.js/node';
import '@angular/compiler';  // MUST be first, before any Angular imports
import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function app(): Promise<Express> {
  const server = express();

  const distFolder = resolve(__dirname, 'dist/web');
  const browserDistFolder = join(distFolder, 'browser');
  const serverDistFolder = join(distFolder, 'server');
  const indexHtml = join(serverDistFolder, 'index.server.html');

  // Load bootstrap from compiled .mjs bundle — NOT from src/
  const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.server.mjs')).href;
  const serverModule = await import(serverBundlePath);
  const bootstrap = serverModule.default;  // Single .default (not .default.default)

  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // Proxy /api/* to backend — proxy.conf.json is ignored by custom Express servers
  server.use('/api', (req: Request, res: Response) => {
    const targetPath = `/api${req.url}`;
    console.log(`[PROXY] ${req.method} ${targetPath} → http://localhost:3000`);

    const options = {
      hostname: 'localhost',
      port: 3000,
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

  server.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static files with no caching during development
  server.get('*.*', express.static(browserDistFolder, {
    maxAge: 0,
    etag: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  // SSR handler for all application routes
  server.get('*', (req: Request, res: Response, next: NextFunction) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [
          { provide: APP_BASE_HREF, useValue: baseUrl }
        ]
      })
      .then((html) => res.send(html))
      .catch(next);
  });

  return server;
}

async function run(): Promise<void> {
  const port = process.env['PORT'] || 8201;
  const server = await app();

  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

if (!process.env.NETLIFY && !process.env.VERCEL) {
  run().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
```

### Angular 20 vs. Angular 21 server.ts: What Changed and Why

| What | Angular 20 | Angular 21 |
|------|-----------|-----------|
| **Rendering API** | `renderApplication()` from server bundle | `CommonEngine` from `@angular/ssr/node` |
| **Server bundle filename** | `main.js` | `main.server.mjs` |
| **Bundle format** | CommonJS | ESM (must use `pathToFileURL`) |
| **Bootstrap extraction** | `serverModule.default.default` (nested) | `serverModule.default` (single) |
| **`renderApplication` source** | `serverModule.default.renderApplication` | Not needed — `CommonEngine` handles it |
| **Document input** | Read file to string, pass as `document:` | Pass path directly as `documentFilePath:` |
| **Provider key** | `platformProviders: [...]` | `providers: [...]` |
| **Index HTML path** | `dist/frontend/browser/index.html` | `dist/web/server/index.server.html` |

**Key callouts for each change:**

**`@angular/compiler` must be first**: Still required in Angular 21. If you don't import it before Angular code, you'll hit:
```
The injectable 'PlatformLocation' needs to be compiled using the JIT compiler,
but '@angular/compiler' is not available.
```
Put it on line 2, right after `zone.js/node`. This was true in Angular 20 too, but it's easy to forget when rewriting `server.ts`.

**Load from bundle, not src**: This is a new Angular 21 trap. In Angular 20 you could sometimes import from source files. In Angular 21, you **must** load from `dist/web/server/main.server.mjs`. Importing from `src/main.server.ts` directly causes:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/main.server.js'
```
The builder doesn't copy source files to a loadable location — load only from the compiled bundle.

**Single `.default` not `.default.default`**: In the Angular 20 server bundle (CommonJS), the bootstrap function was nested as `module.exports.default.default`. In the Angular 21 ESM bundle, the default export is your bootstrap function directly — `serverModule.default`.

**`documentFilePath` not `document`**: `CommonEngine.render()` takes a file path string (`documentFilePath`) and reads it internally. Angular 20's `renderApplication()` required you to `readFile` the HTML yourself and pass the string as `document`. Less code to write, and no async file reading in the route handler.

**`providers` not `platformProviders`**: `CommonEngine.render()` uses `providers` (not `platformProviders`). Both accept the same provider syntax. `APP_BASE_HREF` goes here.

> 📖 **[CommonEngine.render() options](https://angular.dev/api/ssr/node/CommonEngineRenderOptions)**: Full API reference for all render options including `bootstrap`, `documentFilePath`, `url`, `publicPath`, `inlineCriticalCss`, and `providers`.

---

## Build Scripts

### package.json

```json
{
  "scripts": {
    "start": "ng serve --port 8201",

    "start:ssr:dev": "npm run build:ssr:dev && cross-env PORT=8201 ts-node --esm server.ts",
    "build:ssr:dev": "ng build --configuration development && node scripts/copy-index.js",

    "build": "ng build",
    "build:ssr": "ng build --configuration production && node scripts/copy-index.js"
  }
}
```

**Angular 20 comparison:**
```json
// Angular 20 — required a separate server build step
"build:ssr:dev": "ng build --configuration development && ng run frontend:server:development && node scripts/copy-index.js"
```

The `ng run frontend:server:development` step is gone in Angular 21. `ng build --configuration development` now builds both browser and server bundles in one pass. Your build script gets shorter, and there's one fewer target to configure in `angular.json`.

---

## The copy-index Script

This script is conceptually the same as in Angular 20, but must handle the renamed `index.csr.html` output file:

```javascript
// scripts/copy-index.js
const fs = require('fs');
const path = require('path');

// Angular 21 produces index.csr.html, not index.html
const browserIndexCandidates = [
  path.join(__dirname, '../dist/web/browser/index.html'),
  path.join(__dirname, '../dist/web/browser/index.csr.html'),
];
const serverDir = path.join(__dirname, '../dist/web/server');
const serverDestFile = path.join(serverDir, 'index.server.html');

try {
  const sourceFile = browserIndexCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sourceFile) {
    throw new Error('Angular build did not produce index.html or index.csr.html in browser dist');
  }

  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
  }

  fs.copyFileSync(sourceFile, serverDestFile);
  console.log(`✓ Copied ${path.basename(sourceFile)} → server/index.server.html`);
} catch (err) {
  console.error('✗ copy-index failed:', err.message);
  process.exit(1);
}
```

**Why check for both names?** The `application` builder produces `index.csr.html` in Angular 21. But the script checks both names so it doesn't break if Angular changes the naming convention again in Angular 22.

**Why copy to `server/index.server.html`?** `CommonEngine` reads the document from disk. Keeping it in the server dist folder avoids cross-directory path issues and makes the path logic in `server.ts` straightforward.

**Angular 20 comparison**: The Angular 20 version copied `dist/frontend/browser/index.html` to `dist/frontend/server/index.server.html`. The logic is identical — only the folder names and the source filename changed.

---

## Verification: Is SSR Actually Running?

After `npm run start:ssr:dev`, verify each layer is working:

### 1. Server Started
```
Node Express server listening on http://localhost:8201
```
If you see this, Express is running. If it crashes, check the error — the most common causes are covered in the next section.

### 2. SSR is Actually Rendering (Not Just Serving HTML)
```bash
curl http://localhost:8201 | grep "<app-root"
# SSR working: returns <app-root><div ...>actual content...</div></app-root>
# SSR broken: returns <app-root></app-root>
```
If `<app-root>` is empty, SSR rendering failed silently. Check the Express terminal for `SSR rendering error:` messages.

### 3. Styles Are Loading
Open `http://localhost:8201` in a browser. If the page has no styles, the `copy-index.js` script likely copied `src/index.html` (with no bundled styles) instead of `dist/web/browser/index.csr.html` (with `<link>` to compiled styles). Check the Express static file logs.

### 4. API Proxy Is Working
```bash
curl http://localhost:8201/api/health
# Should forward to http://localhost:3000/api/health and return your backend response
```
Check the Express terminal for `[PROXY]` log lines. If you don't see them, the proxy middleware isn't being hit.

### 5. Environment Is Development
```bash
grep "apiUrl" dist/web/browser/main.js | head -1
# Should contain: apiUrl:"/api"
# If it shows your production URL, the fileReplacements didn't apply
```

---

## Errors You'll Hit (And Why)

These are the specific errors encountered when upgrading from Angular 20 to 21, in roughly the order you'll encounter them. Each one has a root cause that's different from what the error message implies.

### Error 1: NG0201 — No provider found for PlatformDestroyListeners

```
ERROR [Error]: NG0201: No provider found for `InjectionToken PlatformDestroyListeners`.
Source: Platform: core.
```

**Root cause**: You're importing `provideServerRendering` from `@angular/platform-server` instead of `@angular/ssr`.

**Fix**: Change the import in `app.config.server.ts`:
```typescript
// Change this:
import { provideServerRendering } from '@angular/platform-server';
// To this:
import { provideServerRendering } from '@angular/ssr';
```

This error appears in Angular 20 and later when using the old `@angular/platform-server` import path. The package move happened in Angular 20 — if you ran `ng update` at that point, the migration schematic would have already fixed this. In Angular 20+, `@angular/platform-server`'s `provideServerRendering` no longer registers the full platform provider chain.

### Error 2: renderApplication is not a function

```
TypeError: renderApplication is not a function
```

or

```
TypeError: Cannot destructure property 'renderApplication' of 'serverModule.default'
as it is undefined.
```

**Root cause**: You're trying to import `renderApplication` from the `main.server.mjs` bundle, which no longer exports it.

**Fix**: Switch to `CommonEngine`. Remove the `renderApplication` import and use `CommonEngine.render()` as shown in the `server.ts` above. The rendering capability is the same — just invoked differently.

### Error 3: Cannot find module main.server.js

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'C:\...\apps\web\dist\web\server\main.server.js'
imported from ...
```

**Root cause**: Your `server.ts` is pointing to `main.server.js` (from Angular 20) but Angular 21 produces `main.server.mjs`.

**Fix**: Update the bundle path:
```typescript
// Angular 20
const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.server.js')).href;
// Angular 21
const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.server.mjs')).href;
```

### Error 4: Angular app engine manifest is not set

```
Error: Angular app engine manifest is not set. Please ensure you are using
the '@angular/build:application' builder to build your server application.
```

**Root cause**: You're using `AngularNodeAppEngine` and running `ts-node server.ts` from the project root. The manifest file exists at `dist/web/server/angular-app-engine-manifest.mjs` but `AngularNodeAppEngine` can't locate it relative to the process working directory.

**Fix**: Switch to `CommonEngine` as described in this guide. If you want to use `AngularNodeAppEngine` specifically, you'd need to run the server from within the dist folder — which defeats the purpose of the local dev setup.

### Error 5: JIT compilation failed — @angular/compiler not available

```
Error: The injectable 'PlatformLocation' needs to be compiled using the JIT compiler,
but '@angular/compiler' is not available.

JIT compilation failed for injectable [PlatformLocation class PlatformLocation]
```

**Root cause**: `import '@angular/compiler'` is missing or not at the top of `server.ts`.

**Fix**: Add it as the second import in `server.ts`, immediately after `zone.js/node`:
```typescript
import 'zone.js/node';
import '@angular/compiler';  // ← must be here, before any other Angular imports
import { APP_BASE_HREF } from '@angular/common';
```

### Error 6: Cannot find module src/main.server.js (not .mjs)

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'C:\...\apps\web\src\main.server.js'
```

**Root cause**: You're importing from the source directory (`src/main.server.ts`) instead of the compiled bundle.

**Fix**: Never import from `src/` in `server.ts`. Always load from the dist bundle:
```typescript
const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.server.mjs')).href;
const serverModule = await import(serverBundlePath);
```

### Error 7: ERR_UNSUPPORTED_ESM_URL_SCHEME (Windows)

```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only file and data URLs are supported
by the default ESM loader. Received protocol 'c:'
```

**Root cause**: On Windows, file paths starting with `C:\` are not valid ESM URLs. Dynamic `import()` requires a `file://` URL.

**Fix**: Use `pathToFileURL` to convert the path:
```typescript
import { pathToFileURL } from 'node:url';
const serverBundlePath = pathToFileURL(join(serverDistFolder, 'main.server.mjs')).href;
// Results in: file:///C:/Users/.../dist/web/server/main.server.mjs
```

### Error 8: TypeScript composite error

```
error TS6306: Referenced project '...tsconfig.app.json' must have setting "composite": true.
```

**Root cause**: Angular 21 uses TypeScript project references, which require `"composite": true` in all referenced tsconfig files.

**Fix**: Add `"composite": true` to `compilerOptions` in `tsconfig.app.json`, `tsconfig.server.json`, and `tsconfig.spec.json`.

---

## Common Pitfalls

### Pitfall 1: Running build:ssr:dev Once But Forgetting to Rebuild After Code Changes

Unlike `ng serve`, there's no hot reload in this setup. After any code change:
```bash
npm run build:ssr:dev
# Then refresh the browser
```

Or to save time, rebuild without restarting the server:
```bash
npm run build:ssr:dev
# (The server still needs a manual restart if server.ts changed)
```

### Pitfall 2: Port Conflicts

```
Error: listen EADDRINUSE: address already in use :::8201
```

```bash
# Windows
netstat -ano | findstr :8201
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:8201 | xargs kill -9
```

Or change the port:
```bash
cross-env PORT=4200 ts-node --esm server.ts
```

### Pitfall 3: Styles Don't Load After Copy-Index Copies the Wrong File

**Symptom**: Page renders with content but completely unstyled.

**Cause**: `copy-index.js` found `src/index.html` (which has no bundled `<link>` tags) instead of `dist/web/browser/index.csr.html` (which has references to compiled CSS).

**Fix**: Verify `copy-index.js` logs show it found `index.csr.html`, not a fallback path. Also check that `ng build` ran successfully before the copy script.

### Pitfall 4: Old Code Still Running After Rebuild

**Symptom**: You changed code but don't see the changes even after rebuilding.

**Causes and fixes**:
1. **Browser cache**: Hard refresh with `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. **Server didn't reload**: `Ctrl+C` then `npm run start:ssr:dev` again
3. **Build didn't run**: Ensure `ng build` succeeded — look for the `Browser application bundle generation complete` message in build output

### Pitfall 5: Wrong Environment in Production Build

**Symptom**: After running `npm run build:ssr`, API calls go to `/api` instead of your production URL.

**Cause**: Used `--configuration development` when you meant `production`, or `fileReplacements` is not configured in `angular.json`.

**Fix**: Verify `angular.json` has `fileReplacements` in the `production` configuration pointing to `environment.prod.ts`.

### Pitfall 6: API Proxy Not Working

**Symptom**: 404 or connection refused on `/api/*` requests.

**Diagnosis**:
1. Is backend running? `curl http://localhost:3000/api/health`
2. Are `[PROXY]` log lines appearing in the Express terminal?
3. Is the environment configured with `apiUrl: '/api'`?

**Cause note**: `proxy.conf.json` is only read by `ng serve` (Angular's dev server). Your custom Express server ignores it entirely — that's why `server.ts` implements the proxy manually using Node's `http` module.

---

## Troubleshooting

### Issue: Server Crashes Immediately on Startup

**Symptoms**: Express starts then crashes before printing the listen message.

**Diagnosis**:
```bash
ts-node --esm server.ts 2>&1 | head -50
```

**Common causes**:
- `main.server.mjs` not found (build didn't run or bundle path is wrong)
- `index.server.html` not found (copy-index.js didn't run)
- Import errors in `server.ts`
- Missing npm packages (`npm install`)

### Issue: `<app-root>` Is Empty (SSR Not Rendering)

**Symptoms**: Page loads but `curl http://localhost:8201 | grep app-root` shows `<app-root></app-root>` with no content.

**Diagnosis**: Check Express terminal output for `SSR rendering error:` messages.

**Common causes**:
- `provideServerRendering` from wrong package (causes `NG0201` which gets caught by `.catch(next)`)
- Browser-specific code running during SSR (use `isPlatformBrowser` guards)
- Missing `documentFilePath` — `index.server.html` doesn't exist

**Fix for platform-specific code**:
```typescript
import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

export class MyComponent {
  platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Browser-only code (localStorage, window, document, etc.)
    }
  }
}
```

> 📖 **[Angular docs — isPlatformBrowser](https://angular.dev/api/common/isPlatformBrowser)**: Use this to guard browser-only APIs from running during server-side rendering.

### Issue: Authentication Doesn't Work

**Symptoms**: Always redirected to login even after successful auth, or auth state lost on page refresh.

**Diagnosis**:
1. Check Network tab → login response → `Set-Cookie` header present?
2. Check subsequent requests → `Cookie` header sent?
3. Check SSR: auth check running server-side when it shouldn't?

**Fix**: Skip auth initialization during SSR:
```typescript
if (!isPlatformBrowser(platformId)) {
  return Promise.resolve();
}
```

### Issue: Build Succeeds But Angular Version Mismatch

**Symptoms**: Build succeeds but server throws version-related errors.

**Fix**: Ensure all Angular packages are on the same version:
```bash
ng version
# All @angular/* packages should be 21.x.x
```

If they're mismatched, run:
```bash
ng update @angular/core @angular/cli @angular/ssr
```

---

## Quick Reference

### Start SSR Dev Server (Full Build + Run)
```bash
cd apps/web
npm run start:ssr:dev
# Opens on http://localhost:8201
```

### Rebuild Only (Without Restarting Server)
```bash
npm run build:ssr:dev
# Then hard-refresh browser (Ctrl+Shift+R)
```

### Verify SSR Is Rendering
```bash
curl http://localhost:8201 | grep "<app-root"
# Should show content inside <app-root>, not empty tags
```

### Verify Environment
```bash
grep "apiUrl" dist/web/browser/main.js
# Should show: apiUrl:"/api"
```

### Test API Proxy
```bash
curl http://localhost:8201/api/health
# Should forward to backend and return response
```

### Clear Everything and Rebuild
```bash
rmdir /s /q dist
npm run build:ssr:dev
```

### Verify Server Bundle Exists
```bash
dir dist\web\server\main.server.mjs
# If missing, build didn't produce server bundle — check angular.json has ssr: true
```

---

## Success Checklist

- [ ] `cross-env` and `ts-node` installed as dev dependencies
- [ ] `angular.json` uses `@angular/build:application` builder (no separate `server` target)
- [ ] `angular.json` has `"server": "src/main.server.ts"` and `"ssr": true` in both `development` and `production` configurations
- [ ] `tsconfig.app.json` has `"composite": true`
- [ ] `tsconfig.app.json` lists `src/main.server.ts` and `src/app/app.config.server.ts` in `files`
- [ ] `tsconfig.server.json` has `"composite": true`
- [ ] `tsconfig.spec.json` has `"composite": true`
- [ ] `src/main.server.ts` exports a default function accepting `BootstrapContext`
- [ ] `app.config.server.ts` imports `provideServerRendering` from `@angular/ssr` (not `@angular/platform-server`)
- [ ] `server.ts` imports `@angular/compiler` before any other Angular imports
- [ ] `server.ts` loads from `dist/web/server/main.server.mjs` (not `main.js`, not `src/`)
- [ ] `server.ts` uses `pathToFileURL()` for the bundle import path (Windows ESM requirement)
- [ ] `server.ts` uses `CommonEngine` (not `AngularNodeAppEngine`, not `renderApplication`)
- [ ] `server.ts` uses `bootstrap = serverModule.default` (single `.default`, not nested)
- [ ] `server.ts` uses `documentFilePath:` in `commonEngine.render()` (not `document:`)
- [ ] `server.ts` uses `providers:` in `commonEngine.render()` (not `platformProviders:`)
- [ ] `scripts/copy-index.js` handles `index.csr.html` filename (not only `index.html`)
- [ ] `package.json` `build:ssr:dev` uses `ng build --configuration development` (no separate server build step)
- [ ] `environment.development.ts` has `apiUrl: '/api'`
- [ ] Backend running on `localhost:3000`
- [ ] `npm run start:ssr:dev` starts server on `http://localhost:8201`
- [ ] Page source shows rendered HTML in `<app-root>` (not empty tags)
- [ ] Styles load correctly
- [ ] `[PROXY]` log lines appear for API requests
- [ ] Authentication works without login flash

---

## Complete Summary

### What We Were Trying to Do

Run true server-side rendering locally during development — meaning every page request is rendered on the server before being sent to the browser. This mirrors production behavior, which is essential for testing SSR-specific features like meta tags, server routes, and authentication flows that depend on the initial server response.

In Angular 20, this was achieved with a custom Express server that loaded the `@angular-devkit/build-angular:server` output (`main.js`), called `renderApplication()` from that bundle, and proxied API requests to the local backend. That setup worked reliably.

### What Changed When Migrating to the Modern SSR Setup

The modern `@angular/build:application` builder (introduced in Angular 17) replaced the dual-builder SSR architecture. The change was well-motivated — one build, one configuration, one tool — but it requires updates to existing local dev setups:

1. **The `server` target in `angular.json` was removed.** The unified builder handles both browser and server bundles when `"ssr": true` is set in the configuration.

2. **The server bundle changed format.** From CommonJS `main.js` to ESM `main.server.mjs`. This requires `pathToFileURL()` for dynamic import on Windows, and means the bundle no longer exports `renderApplication`.

3. **The index HTML was renamed.** From `index.html` to `index.csr.html`. Any script that copies the index template must be updated to look for the new name.

4. **`provideServerRendering` moved packages (Angular 20).** From `@angular/platform-server` to `@angular/ssr`. This change happened in Angular 20, not Angular 21. Using the old import path causes `NG0201: No provider found for PlatformDestroyListeners` — an error that's completely opaque about its actual cause.

5. **The new recommended API, `AngularNodeAppEngine`, doesn't work for this pattern.** It reads a manifest file that can't be located when running `ts-node server.ts` from the project root. It's the right tool for production, but not for local dev with a custom Express server.

6. **TypeScript project references are now required.** All three tsconfig files need `"composite": true`. The unified builder also requires server entry files (`main.server.ts`, `app.config.server.ts`) to be listed in `tsconfig.app.json`'s `files` array.

### What the Working Solution Looks Like

The key insight was that **`CommonEngine` from `@angular/ssr/node` is the stable, explicitly-controlled path for custom Node.js servers in Angular 21**. Unlike `AngularNodeAppEngine`, it doesn't rely on manifest-based auto-discovery. You load your bootstrap function from the compiled `.mjs` bundle, pass it to `commonEngine.render()` along with explicit paths for the document and public files, and you're done.

The complete working setup in Angular 21:

| Component | Older Setup | Recommended Setup |
|-----------|-----------|-----------|
| Builder | Two builders (application + server) | One builder (`@angular/build:application`) |
| Build command | `ng build` + `ng run :server:dev` | `ng build --configuration development` |
| Server bundle | `main.js` (CommonJS) | `main.server.mjs` (ESM) |
| Index HTML | `index.html` | `index.csr.html` |
| Rendering API | `renderApplication()` from bundle | `CommonEngine` from `@angular/ssr/node` |
| `provideServerRendering` | From `@angular/platform-server` | From `@angular/ssr` |
| Bootstrap extraction | `serverModule.default.default` | `serverModule.default` |
| tsconfig `composite` | Not needed | Required in all three tsconfig files |
| Server files in `tsconfig.app.json` | Not needed | Required in `files` array |

### The Errors and Their Root Causes

Every error encountered during this upgrade had a specific root cause:

- **NG0201 PlatformDestroyListeners** → wrong `provideServerRendering` package
- **renderApplication is not a function** → the unified builder no longer exports it from the server bundle"
- **Cannot find module main.server.js** → filename changed to `.mjs`
- **Angular app engine manifest is not set** → `AngularNodeAppEngine` can't find manifest from project root
- **JIT compilation failed** → `@angular/compiler` import missing or not first
- **Cannot find module src/main.server.js** → importing from source instead of compiled bundle
- **ERR_UNSUPPORTED_ESM_URL_SCHEME** → Windows requires `pathToFileURL()` for ESM dynamic imports
- **TypeScript composite error** → the unified builder requires `"composite": true` in all referenced tsconfigs

### What Didn't Change

Despite all the above, several things are identical between Angular 20 and 21:
- The API proxy implementation using Node's `http.request()` — `proxy.conf.json` is still ignored by custom Express servers in both versions
- The `BootstrapContext` parameter in `main.server.ts` — required in both
- The `fileReplacements` approach for environment-specific builds — unchanged
- Static file serving and caching strategy — unchanged
- The overall Express server structure — same middleware ordering, same route handler pattern

---

## Next Steps

With local SSR working on Angular 21:
1. **Test SSR-specific features** (meta tags, Open Graph, server routes, canonical URLs)
2. **Debug SSR hydration issues** — check for `ExpressionChangedAfterItHasBeenCheckedError` after hydration
3. **Test authentication flows** — verify httpOnly cookies work correctly server-side
4. **Prepare for AngularNodeAppEngine** — once Angular tooling matures, this will be the cleaner path for production

---

## Additional Resources

- **[Angular SSR Guide](https://angular.dev/guide/ssr)** — Official documentation for Angular 21 SSR setup
- **[CommonEngine API](https://angular.dev/api/ssr/node/CommonEngine)** — The rendering engine used in this guide
- **[AngularNodeAppEngine API](https://angular.dev/api/ssr/node/AngularNodeAppEngine)** — The future of Angular Node.js SSR
- **[provideServerRendering API](https://angular.dev/api/ssr/provideServerRendering)** — The `@angular/ssr` import
- **[BootstrapContext API](https://angular.dev/api/platform-browser/BootstrapContext)** — Required for SSR bootstrap
- **[isPlatformBrowser](https://angular.dev/api/common/isPlatformBrowser)** — Guard browser-only code
- **[Part 1: Angular 20 SSR Local Dev](/blog/angular-ssr-local-development)** — The Angular 20 version of this guide

---

> **Skip the Boilerplate with StackInsight**
> If you want this Angular 21 SSR dev setup pre-wired with production-ready auth, check out the StackInsight starter — it packages the patterns from this guide into a ready-to-run project.
> Learn more at [stackinsight.app](https://stackinsight.app)

**Questions or feedback?** Reach out via [contact form](https://stackinsight.dev/contact) or [@stackinsightDev](https://x.com/StackInsightDev)

---

*This guide reflects the actual working implementation used during the Angular 20 → 21 upgrade. All configurations tested with Angular 21.1.5, Node 20, and Express 4.*
