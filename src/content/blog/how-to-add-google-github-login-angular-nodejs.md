---
title: "How to Add Google & GitHub Login in Angular + Node.js (Step-by-Step Guide)"
pubDate: "2025-10-07"
heroImage: '../../assets/how-to-add-google-github-login-angular-nodejs.webp'
author: "Ko-Hsin Liang"
categories: ["Authentication", "Angular", "Node.js", "OAuth", "TypeScript"]
repo: ""
description: "Complete step-by-step guide to implementing Google and GitHub OAuth2 login in Angular + Node.js without Passport.js. Learn how to build secure social authentication with JWT cookies, automatic account linking, and modern TypeScript code."
metaDescription: "Learn how to add Google and GitHub OAuth login to Angular and Node.js apps. Complete guide with code examples, security best practices, and automatic account linking."
keywords: ["angular oauth", "google login angular", "github oauth nodejs", "angular social login", "oauth2 nodejs", "angular authentication", "google oauth2", "github login", "jwt cookies", "social authentication", "angular node.js auth"]
ogTitle: "Google & GitHub OAuth Login: Angular + Node.js Complete Guide"
ogDescription: "Build secure Google and GitHub login for Angular + Node.js. No Passport.js needed. Includes automatic account linking, JWT sessions, and production-ready code."
ogImage: "/assets/how-to-add-google-github-login-angular-nodejs.webp"
ogType: "article"
twitterCard: "summary_large_image"
twitterCreator: "@stackinsightDev"
publishedDate: "2025-10-07T00:00:00Z"
section: "Authentication & Security"
tags: ["OAuth2", "Angular", "Node.js", "Express", "Google Login", "GitHub Login", "JWT", "Authentication", "Social Login", "Prisma", "TypeScript", "Security"]
readTime: 15
wordCount: 3200
canonicalUrl: "https://stackinsight.dev/blog/how-to-add-google-github-login-angular-nodejs"

---

# How to Add Google & GitHub Login in Angular + Node.js (Step-by-Step Guide)

Want users to sign in with one click? Let’s add Google and GitHub OAuth to your Angular + Node.js app. No heavy libraries — just clear, modern code you can own and debug.

---

## Introduction

Password logins slow people down. Users forget them, you end up managing resets, and it all adds friction.

Social login changes that. When users click **“Continue with Google”** or **“Sign in with GitHub”**, they’re in — no password, no recovery emails, just instant access.

This tutorial walks you through how to build secure **Google and GitHub login integration** using **Angular 17 + Node.js + Express + Prisma** — no Passport.js, no third-party wrappers. By the end, you’ll have a working OAuth2 flow that’s easy to extend to other providers.

You’ll build:

* Google and GitHub login buttons
* A full OAuth2 backend with Node.js
* Smart account creation and linking
* Secure JWT cookie sessions

Let’s make it happen.

---

## Setup Overview

Before coding, you need to register your app with Google and GitHub.

### Create Google OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Navigate to **APIs & Services → Credentials**.
4. Choose **Create Credentials → OAuth 2.0 Client ID**.
5. Add redirect URI:

   ```
   http://localhost:4000/api/pro/auth/social-login
   ```
6. Save your **Client ID** and **Client Secret**.

### Create GitHub OAuth App

1. Open [GitHub Developer Settings](https://github.com/settings/developers).
2. Click **New OAuth App**.
3. Set Authorization callback URL to the same endpoint:

   ```
   http://localhost:4000/api/pro/auth/social-login
   ```
4. Save your **Client ID** and **Client Secret**.

**Tip:** Use the same callback for both providers. You’ll distinguish which provider was used via a `state` parameter.

---

### Configure Environment

Create your `.env` file in the backend and add the following:

```bash
# backend/.env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/pro/auth/social-login
GOOGLE_OAUTH_SCOPES=openid email profile

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_secret
GITHUB_REDIRECT_URI=http://localhost:4000/api/pro/auth/social-login
GITHUB_OAUTH_SCOPES=read:user user:email

FRONTEND_URL=http://localhost:4200
```

Never commit `.env` files to Git — it’s your vault for sensitive keys. Add them to `.gitignore` right away.

---

## Backend (Node.js + Express)

Now let’s build the OAuth flow step-by-step. This is the engine behind your “Continue with Google/GitHub” buttons.

### Step 1: Provider Configuration

Centralize all OAuth settings in one place. This helps you validate configs and reduce errors at runtime.

**File:** `backend/src/pro/config/socialProviders.ts`

```typescript
export function resolveGoogleConfig() {
  const scopes = (process.env.GOOGLE_OAUTH_SCOPES || 'openid email profile')
    .split(/[\s,]+/)
    .filter(Boolean);

  return {
    clientId: ensure(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID', 'google'),
    clientSecret: ensure(process.env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET', 'google'),
    redirectUri: ensure(process.env.GOOGLE_REDIRECT_URI, 'GOOGLE_REDIRECT_URI', 'google'),
    scopes,
  };
}

export function resolveGithubConfig() {
  const scopes = (process.env.GITHUB_OAUTH_SCOPES || 'read:user user:email')
    .split(/[\s,]+/)
    .filter(Boolean);

  return {
    clientId: ensure(process.env.GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID', 'github'),
    clientSecret: ensure(process.env.GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET', 'github'),
    redirectUri: ensure(process.env.GITHUB_REDIRECT_URI, 'GITHUB_REDIRECT_URI', 'github'),
    scopes,
  };
}

function ensure(value: string | undefined, key: string, provider: string): string {
  if (!value) {
    throw new Error(`Missing ${provider} OAuth configuration for ${key}`);
  }
  return value;
}
```

By validating at startup, you catch config issues before your users do.

---

### Step 2: Google OAuth Service

Handles token exchange and user profile retrieval.

**File:** `backend/src/pro/services/socialAuthService.ts`

```typescript
export function getGoogleAuthorizationUrl() {
  const { clientId, redirectUri, scopes } = resolveGoogleConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: 'google',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function handleGoogleCallback(code: string) {
  const { clientId, clientSecret, redirectUri } = resolveGoogleConfig();

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const { access_token } = await tokenResponse.json();
  if (!access_token) throw new OAuthError('No access token received');

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  const profile = await profileResponse.json();

  return upsertUserFromProfile({
    provider: 'google',
    providerId: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified,
    name: profile.name,
    avatarUrl: profile.picture,
  });
}
```

Google’s API conveniently returns everything in one request — simple and predictable.

---

### Step 3: GitHub OAuth Service

GitHub requires an extra step to fetch verified emails.

```typescript
export function getGithubAuthorizationUrl() {
  const { clientId, redirectUri, scopes } = resolveGithubConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: 'github',
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function handleGithubCallback(code: string) {
  const { clientId, clientSecret, redirectUri } = resolveGithubConfig();

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  const { access_token } = await tokenResponse.json();
  if (!access_token) throw new OAuthError('No access token received');

  const userResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const user = await userResponse.json();

  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const emails = await emailsResponse.json();
  const primaryEmail = emails.find((e: any) => e.primary && e.verified)?.email;

  return upsertUserFromProfile({
    provider: 'github',
    providerId: String(user.id),
    email: primaryEmail,
    emailVerified: !!primaryEmail,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
  });
}
```

If your GitHub users have no verified email, the flow will fail — that’s expected. Always ensure your app handles that gracefully.

---

### Step 4: User Creation & Linking

Now, let’s merge logic for account linking. Existing users should connect providers automatically.

```typescript
async function upsertUserFromProfile(profile: SocialProfile) {
  const providerField = profile.provider === 'google' ? 'googleId' : 'githubId';

  const existingByProvider = await prisma.user.findUnique({
    where: { [providerField]: profile.providerId } as any,
  });

  if (existingByProvider) {
    return updateUserFromProfile(existingByProvider.id, profile);
  }

  if (profile.email) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (existingByEmail) {
      return updateUserFromProfile(existingByEmail.id, profile);
    }
  }

  if (!profile.email) {
    throw new OAuthError('Email required for account creation');
  }

  return prisma.user.create({
    data: {
      email: profile.email,
      password: null,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      emailVerified: profile.emailVerified ?? true,
      authProvider: profile.provider,
      googleId: profile.provider === 'google' ? profile.providerId : null,
      githubId: profile.provider === 'github' ? profile.providerId : null,
    },
  });
}
```

This flow covers all bases:

* Existing OAuth user → updates info
* Existing email → links new provider
* New user → creates account

This is a pattern you can reuse for any provider in future.

---

### Step 5: Controller & Routes

Finally, wire everything together.

**File:** `backend/src/pro/controllers/socialAuthController.ts`

```typescript
export async function socialLogin(req: Request, res: Response) {
  const { provider, code } = req.body;

  const user = provider === 'google'
    ? await handleGoogleCallback(code)
    : await handleGithubCallback(code);

  if (user.twoFactorEnabled) {
    return res.json({ requires2FA: true });
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000,
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ user });
}
```

The frontend will post `{ provider, code }`, and your backend will handle the rest.

---

## Frontend (Angular)

Now for the fun part — building the buttons that trigger all this magic.

### Step 6: Auth Service

Handles redirects, callbacks, and token exchange.

```typescript
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = environment.apiUrl + '/pro/auth';

  getGoogleAuthUrl() {
    return this.http.get<{ url: string }>(`${this.api}/google`);
  }

  getGithubAuthUrl() {
    return this.http.get<{ url: string }>(`${this.api}/github`);
  }

  socialLogin(provider: 'google' | 'github', code: string) {
    return this.http.post(`${this.api}/social-login`, { provider, code }, { withCredentials: true });
  }

  handleSocialCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') as 'google' | 'github' | null;

    if (code && state) {
      window.history.replaceState({}, '', '/login');

      return this.socialLogin(state, code).pipe(
        tap((response: any) => {
          if (response.requires2FA) {
            this.router.navigateByUrl('/two-factor');
          } else {
            this.router.navigateByUrl('/dashboard');
          }
        })
      );
    }

    return of(null);
  }
}
```

This service keeps the login flow seamless between frontend and backend.

---

### Step 7: Login Component

Clean UI with two buttons and built-in callback handling.

```typescript
@Component({
  selector: 'app-login',
  template: `
    <div class="login-container">
      <h2>Login</h2>

      <div class="social-buttons">
        <button (click)="loginWithGoogle()" class="btn-google">
          Continue with Google
        </button>

        <button (click)="loginWithGithub()" class="btn-github">
          Continue with GitHub
        </button>
      </div>

      <div class="divider">OR</div>
      <!-- Optional email/password form -->
    </div>
  `
})
export class LoginPage implements OnInit {
  private auth = inject(AuthService);

  ngOnInit() {
    this.auth.handleSocialCallback().subscribe();
  }

  loginWithGoogle() {
    this.auth.getGoogleAuthUrl().subscribe({
      next: (response) => (window.location.href = response.url),
    });
  }

  loginWithGithub() {
    this.auth.getGithubAuthUrl().subscribe({
      next: (response) => (window.location.href = response.url),
    });
  }
}
```

Simple, intuitive, and reusable for any other OAuth provider later.

---

## Testing & Debugging

### Quick Test Checklist

1. Start backend: `npm run dev`
2. Start frontend: `ng serve`
3. Click **“Continue with Google”**
4. Approve OAuth prompt
5. Check cookies and user data

### Common Pitfalls

**Redirect URI mismatch:**
Ensure the callback URL matches exactly, no trailing slashes.

**GitHub returns no email:**
User must have a verified email address.

**Cookies not stored:**

* Add `withCredentials: true` to all HTTP requests.
* Allow your frontend URL in backend CORS settings.
* Use HTTPS in production.

---

## Security & Best Practices

**Use HTTPS in production**  
OAuth requires it. Cookies need `secure: true`.

**Store tokens in httpOnly cookies**  
JavaScript can't access them. Prevents XSS attacks.

**Validate state parameter**  
Prevents CSRF. Each provider uses its own state.

**Short access tokens**  
15 minutes max. Use refresh tokens for long sessions.

**Never expose secrets**  
Use `.env` files. Never commit them.

---

## FAQ

**Q: How do I add Google login to Angular with Node.js backend?**  
A: Create OAuth app in Google Cloud Console, get auth URL from backend, redirect user, exchange code for tokens, issue JWT cookies.

**Q: Can I use both Google and GitHub OAuth in one app?**  
A: Yes! Use the `state` parameter to identify which provider is calling back. Both can share the same callback URL.

**Q: How do I secure OAuth tokens in Node.js?**  
A: Store JWT tokens in HTTP-only, secure cookies. Never expose them to JavaScript. Use short expiration times.

**Q: What if a user has both Google and GitHub accounts with the same email?**  
A: The code links them automatically by matching email addresses. First login creates the account, second login updates the provider ID.

**Q: Do I need Passport.js for OAuth2?**  
A: No. This tutorial shows how to implement OAuth2 from scratch with just `fetch()`. You have full control and fewer dependencies.

---

## Conclusion

You’ve just built a professional-grade OAuth system for Angular and Node.js — no Passport.js, no shortcuts, no confusion.

You now have:

* A clean OAuth2 authorization flow
* Automatic account linking
* Secure cookie-based JWT sessions
* A frontend experience users instantly trust

It’s the kind of feature that turns a basic app into a real product. And the best part? You understand every piece of it.

Next time you need another provider — Twitter, Discord, or Apple — you already have the foundation. Swap the endpoints, tweak scopes, and you’re done.

That’s what full-stack control feels like.

> **Production-Ready Auth with Social Login**  
> If you want email/password, Google, and GitHub login with JWT httpOnly cookies already integrated into an Angular + Node.js stack, **StackInsight Auth Pro** gives you that foundation out of the box — with clean TypeScript, Prisma, and deployment patterns ready to go.  
> Check it out at [stackinsight.app](https://stackinsight.app)

