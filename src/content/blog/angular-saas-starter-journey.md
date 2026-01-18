---
title: "I Spent 3 Months Building Auth So You Don't Have To: The Real Story"
pubDate: "2026-01-18"
heroImage: '../../assets/angular-saas-starter-journey.webp'
author: "Ko-Hsin Liang"
categories: ["Authentication", "Angular", "SaaS", "Real-World", "Security"]
repo: "https://github.com/stackinsight/stackinsight-auth-lite"
description: "Three months. 15,000+ lines of code. More edge cases than I thought possible. This is the unfiltered story of building production-ready authentication for Angular SaaS apps—and why you shouldn't have to do this yourself."
metaDescription: "The real story of building complete authentication: email/password, OAuth (Google, GitHub, Twitter), 2FA, magic links, and passwordless. Three months of work so you don't have to."
keywords: ["angular authentication", "saas starter", "oauth implementation", "2fa totp", "magic links", "passwordless auth", "jwt cookies", "production auth", "auth0 alternative", "authentication journey"]
ogTitle: "3 Months Building Auth: The Complete Journey (So You Don't Have To)"
ogDescription: "From 'How hard can auth be?' to 15,000+ lines later. The honest story of building production-ready authentication with all the edge cases, failures, and lessons learned."
ogImage: "/assets/angular-saas-starter-journey.webp"
ogType: "article"
twitterCard: "summary_large_image"
twitterCreator: "@stackinsightDev"
publishedDate: "2026-01-18T00:00:00Z"
section: "Authentication"
tags: ["Authentication", "Angular", "SaaS", "OAuth", "2FA", "Magic Links", "JWT", "Security", "Real-World", "Production"]
readTime: 15
wordCount: 3850
canonicalUrl: "https://stackinsight.dev/blog/angular-saas-starter-journey"
---

# I Spent 3 Months Building Auth So You Don't Have To: The Real Story

**Month 1:** "This will take 2 weeks, tops."  
**Month 2:** "I'm only halfway done. How is that possible?"  
**Month 3:** "Oh. *This* is why Auth0 charges $8,000/month."

This is the story of building **StackInsight Auth Pro**—a complete, production-ready authentication system for Angular SaaS applications. Three months of full-time work. 15,000+ lines of code. More edge cases than I ever imagined existed. And one crystal-clear realization: **you shouldn't have to do this yourself**.

*Last updated: January 18, 2026 | Angular 20, Node.js 20, Tested in production*

---

## The Moment Everything Changed

It started with what seemed like a simple question: *"How hard can authentication be?"*

I was building a SaaS product. I needed user authentication. After looking at Auth0's pricing ($96k/year at my target scale), I decided to build it myself.

**My initial estimate:** "Maybe 2 weeks?"

**Reality:** Three months. 15,000+ lines of code. More edge cases than I thought existed in the entire universe.

**Was it worth it?** Absolutely. But not for the reasons I expected.

This is the unfiltered, week-by-week story of what it *actually* takes to build production-ready authentication. Every edge case. Every mistake. Every "oh, that's why Auth0 charges so much" moment.

*Looking for the business case and cost analysis?* Read [why I refused to pay Auth0 $96,000/year](/blog/why-i-built-my-own-auth) for the pricing breakdown and ROI calculations.

---

## Week 1-2: The "Easy" Part (Narrator: It Wasn't Easy)

### Day 1-3: Basic Email/Password Auth

I started with confidence. How complicated could it be?

```typescript
// My Day 1 thought process:
// 1. Hash password with bcrypt ✓
// 2. Store in database ✓
// 3. Generate JWT ✓
// 4. Ship it!

// Reality check on Day 3:
// Wait... what about:
// - Refresh tokens?
// - Token versioning for instant logout?
// - Secure cookie settings?
// - CSRF protection?
// - Rate limiting?
// - Session management across devices?
// - What if someone changes their password?
```

**What I actually built:**
- bcrypt password hashing (learned the hard way: use bcrypt, not bcryptjs—performance matters)
- JWT access tokens with 15-minute expiry
- Refresh tokens with 7-day expiry and automatic rotation
- HttpOnly, Secure, SameSite cookies (no localStorage—that's asking for XSS attacks)
- Token versioning for instant logout across all devices
- Rate limiting on login attempts

**Time spent:** 3 days (I thought it would be 1 day)

**Mistakes I made:**
- Initially used synchronous bcrypt → blocked the entire event loop → users waited 2 seconds for login
- Stored tokens in localStorage → realized this is a massive XSS vulnerability
- Forgot about token refresh UX → users got logged out mid-action and lost their work

The last one hurt. I was testing the app, filling out a long form, and suddenly—401 Unauthorized. My token expired. Form data: gone. That's when I learned: **token refresh can't be an afterthought**.

---

### Day 4-7: Email Verification

"Just send an email with a token, right?"

**Wrong.**

**What I learned the hard way:**
- Email deliverability is an art form (SPF, DKIM, DMARC—these aren't optional)
- Tokens need expiry (24 hours is the sweet spot)
- Tokens must be single-use (otherwise replay attacks)
- Users will click verification links multiple times (handle gracefully)
- Users will click expired links and expect helpful error messages
- Some email providers delay emails by *hours* (looking at you, Outlook)

**What I built:**
- Expiring email tokens (24-hour window)
- Resend verification flow with rate limiting
- Beautiful HTML email templates (that actually render in Outlook)
- Support for both Nodemailer and Resend
- Token invalidation after first use
- Clear, actionable error messages for every scenario

**Time spent:** 4 days

**Surprise challenges:**
- Outlook blocks certain CSS styles → emails looked broken
- Gmail truncates emails over a certain length → had to optimize
- Mobile email clients render differently than desktop → tested on 6 different clients
- SPF/DKIM/DMARC configuration → spent a full day just on deliverability

---

### Day 8-14: Password Reset

I thought this would be copy-paste from email verification.

**I was so wrong.**

**New edge cases I discovered:**
1. What if a user requests a reset while already logged in?
2. What if they change their password while a reset link is still active?
3. What if they request multiple reset links?
4. Should we notify them on successful reset? (Yes—security best practice)
5. Should we invalidate all sessions when password changes? (Yes—prevent account takeover)
6. Should the error message reveal if an email exists in the system? (No—security risk)

**What I built:**
- Complete password reset flow with email
- Secure reset token generation and validation
- Session invalidation on password change (all devices logged out)
- Success notification emails
- Password strength requirements with real-time feedback
- Intentionally vague error messages ("If an account exists, we sent an email")

**Time spent:** 7 days (yes, really)

**The security vs. UX dilemma:**
Every security decision has UX implications. Every UX decision has security implications. For example:
- **Security says:** Don't reveal if an email exists
- **UX says:** Tell users if they typed the wrong email
- **Solution:** "If an account exists, we sent an email" (same message either way)

This balance took days to get right.

---

## Week 3-4: OAuth (Welcome to the Rabbit Hole)

"OAuth is standardized. This should be quick."

**Narrator:** *It was not quick.*

### Google OAuth: The "Easy" One

Google has great documentation. This should be straightforward.

**Challenges I didn't expect:**
- Setting up Google Cloud Console is more complicated than it should be
- Redirect URIs must match *exactly* (including trailing slashes)
- Extracting email from the profile response (different structure than expected)
- Linking accounts when email already exists (what's the right UX?)
- Handling "user denies permission" gracefully
- Testing with different account states (verified vs. unverified email)

**What I built:**
- Complete Google OAuth 2.0 integration
- Intelligent account linking by email
- Profile picture import and storage
- Automatic email verification (Google already verified it)
- State parameter for CSRF protection
- Error handling for every possible failure mode

**Time spent:** 3 days

**The "aha" moment:**
When a user signs up with email/password, then later tries to log in with Google using the same email—what happens? I spent a full day just thinking through this flow. The solution: automatically link accounts, but require password confirmation for security.

---

### GitHub OAuth: Similar But Different

GitHub seemed like it would be identical to Google.

**Surprise:** GitHub doesn't always return email!

**The problem:**
1. GitHub's default scope doesn't include email
2. You need to request `user:email` scope explicitly
3. Even then, you need a *separate* API call to `/user/emails`
4. You must filter for verified emails only
5. Some users have no verified email at all

**What I built:**
- GitHub OAuth with proper email fetching
- Verified email prioritization (primary verified email first)
- Fallback error messages when no verified email exists
- Public vs. private email handling
- Graceful degradation when email isn't available

**Time spent:** 2 days

**The frustrating part:**
GitHub's API returns an *array* of emails. Which one do you use? The primary? The verified one? What if the primary isn't verified? I tested with 5 different GitHub accounts with different email configurations to get this right.

---

### Twitter OAuth 2.0: The PKCE Challenge

Twitter requires PKCE (Proof Key for Code Exchange). This was completely new territory.

**What is PKCE?**
- Generate a random code verifier (43-128 characters)
- Hash it with SHA-256 to create a code challenge
- Send the challenge in the authorization request
- Send the verifier in the token exchange
- Server verifies they match
- Prevents authorization code interception attacks

**Challenges:**
- Storing code verifiers temporarily (used in-memory Map for dev, should use Redis in production)
- Verifier expiry and cleanup (memory leaks if not handled)
- Twitter's limited email access (requires elevated access approval)
- Different error response formats than Google/GitHub
- Testing without elevated access (had to mock responses)

**Time spent:** 4 days (including learning PKCE from scratch)

**The realization:**
PKCE isn't just a Twitter thing—it's becoming the standard for OAuth 2.0. I had to refactor my entire OAuth abstraction to support both traditional OAuth and PKCE flows. This meant touching every OAuth provider.

---

### Facebook OAuth: The Verification Nightmare

I built the code. I tested it locally. I submitted for verification.

**Status:** Still waiting after 6 weeks. No response from Facebook.

**Decision:** Left the backend code in place, removed frontend buttons, documented it as "untested"

**The lesson:**
Enterprise integrations have business process delays, not just technical ones. Sometimes the hardest part of OAuth isn't the code—it's getting approved by the platform.

---

## Week 5-6: Two-Factor Authentication (2FA/TOTP)

This is where I truly understood why companies charge for MFA.

### The Basics (The "Easy" Part)

**What I needed to build:**
1. TOTP secret generation
2. QR code generation
3. QR code display in the frontend
4. 6-digit code verification
5. Backup codes (for when users lose their device)
6. Recovery flow

**Libraries I used:**
- `speakeasy` for TOTP generation and verification
- `qrcode` for QR code generation
- `angularx-qrcode` for frontend display

**Time spent:** 3 days for basic implementation

**The first test:**
I scanned the QR code with Google Authenticator. Entered the 6-digit code. It worked. I felt like a genius.

Then I started testing edge cases...

---

### The Devil in the Details (The Hard Part)

**Edge cases that took another 4 days:**

**1. 2FA Setup Flow**
- Generate secret but don't save it yet (what if user abandons setup?)
- User must verify a code before enabling (prove they scanned it correctly)
- What if user refreshes the page during setup? (secret is lost)
- Clear UI distinction between "setting up" vs. "enabled" states
- What if user enables 2FA, then immediately loses their device?

**2. 2FA Login Flow**
- Issue temporary token after password verification
- Require 2FA code before issuing full session tokens
- Temporary token expiry (5 minutes—long enough to find your phone, short enough to be secure)
- Handle wrong codes gracefully (don't lock the account immediately)
- Rate limiting on verification attempts (5 attempts per 15 minutes)
- What if the temporary token expires while user is entering the code?

**3. 2FA Recovery**
- What if user loses their device?
- Generate 10 one-time backup codes
- Store them hashed (like passwords)
- Allow disabling 2FA with a backup code
- Send email notification when 2FA is disabled (security alert)
- What if user loses backup codes too? (support intervention required)

**4. Integration with OAuth**
- User with 2FA enabled logs in via Google → still needs 2FA
- Temporary token issued for OAuth users too
- Consistent flow regardless of login method
- Edge case: User enables 2FA, then adds Google OAuth—does Google login require 2FA? (Yes)

**Total time on 2FA:** 10 days

**The breaking point:** Day 8 of 2FA implementation. I was testing the recovery flow. I realized: if a user enables 2FA, loses their device, loses their backup codes, and doesn't have access to their email—they're locked out forever. There's no way around it. That's when I understood: **2FA isn't one feature—it's a complete authentication layer that touches everything**.

---

## Week 7-8: Passwordless Authentication

Magic links and OTP codes. After 2FA, this seemed straightforward.

### Magic Links

**The flow:**
1. User enters email
2. Generate secure token, send link via email
3. User clicks link
4. Automatically logged in

**Challenges I didn't expect:**
- Token expiry (15 minutes—balance between security and UX)
- Single-use tokens (prevent replay attacks)
- What if user requests multiple magic links? (invalidate old ones)
- Mobile vs. desktop (link opens in different browser—how to handle?)
- Email client pre-fetching links (Microsoft Outlook does this!)

**The Outlook problem:**
Outlook's "safe links" feature pre-fetches URLs in emails to scan for malware. This means your magic link gets "clicked" before the user even sees the email. The token is consumed. User clicks the link—it's already invalid.

**Solution:** 
- Don't consume the token on first access
- Set a flag that it's been accessed
- Allow one actual login within 5 minutes of first access
- After login, invalidate completely

**Time spent:** 4 days (3 days debugging the Outlook issue)

---

### OTP Codes (Email-Based)

**The flow:**
1. User enters email
2. Generate 6-digit code, send via email
3. User enters code
4. Logged in

**Seems simple, right?**

**Challenges:**
- Code expiry (10 minutes)
- Rate limiting (prevent brute force—only 5 attempts)
- Resend functionality (with rate limiting)
- What if user requests multiple codes? (only the latest is valid)
- Code format (6 digits is standard, but should it be numeric only?)
- Email deliverability (again)

**The brute force problem:**
6-digit code = 1,000,000 possibilities. If someone can try unlimited times, they can brute force it. Solution: 5 attempts max, then lock for 15 minutes. But what if a legitimate user makes typos? Solution: clear error messages showing remaining attempts.

**Time spent:** 3 days

---

## Week 9-10: Session Management

By this point, I had multiple authentication methods. Now I needed to manage sessions properly.

### The Requirements

- Users should see all active sessions
- Users should be able to log out individual sessions
- Users should be able to log out all other sessions
- Show device information (browser, OS, location)
- Show last active time
- Highlight current session

**The implementation:**
- Store refresh tokens in database with metadata
- Track user agent, IP address, last used timestamp
- Parse user agent to extract device info
- Implement "log out everywhere" (delete all refresh tokens)
- Implement "log out this device" (delete specific refresh token)

**Time spent:** 5 days

**The privacy concern:**
Storing IP addresses and user agents—is this GDPR compliant? Had to research data retention policies, add privacy notices, and implement data deletion on account closure.

---

## Week 11-12: Rate Limiting & Security Hardening

Authentication works. Now to make it secure against real-world attacks.

### Rate Limiting

**What I implemented:**
- Login attempts: 5 per 15 minutes per IP
- Password reset requests: 3 per hour per email
- Email verification resends: 3 per hour per email
- 2FA attempts: 5 per 15 minutes per session
- Magic link requests: 3 per hour per email
- OTP requests: 3 per hour per email

**The challenge:**
How do you store rate limit counters? In-memory? Database? Redis?
- In-memory: Fast but doesn't work with multiple servers
- Database: Slow and creates unnecessary load
- Redis: Perfect but adds infrastructure dependency

**Solution:** Started with in-memory for MVP, documented Redis migration for production.

**Time spent:** 4 days

---

### Security Hardening

**What I added:**
- CSRF protection for all state-changing operations
- Helmet.js for security headers
- Content Security Policy (CSP)
- XSS protection (sanitize all user inputs)
- SQL injection prevention (Prisma handles this, but validated anyway)
- Timing attack prevention (constant-time string comparison)
- Account enumeration prevention (same error messages)

**The timing attack problem:**
When checking passwords, if you return early on the first wrong character, an attacker can measure response time to guess the password character by character. Solution: Always hash the input and compare, even if the user doesn't exist.

**Time spent:** 6 days

---

## Month 3: Polish, Testing, and Documentation

### Week 13: Error Handling

Every endpoint needed proper error handling:
- Validation errors (400)
- Authentication errors (401)
- Authorization errors (403)
- Not found errors (404)
- Rate limit errors (429)
- Server errors (500)

**The goal:** Every error should tell the user exactly what went wrong and how to fix it.

**Time spent:** 5 days

---

### Week 14: Testing

**What I tested:**
- Unit tests for all utility functions
- Integration tests for all API endpoints
- E2E tests for complete user flows
- Security tests (try to break it)
- Performance tests (can it handle load?)

**Test coverage:** 87%

**Time spent:** 7 days

**The bug I almost missed:**
During load testing, I discovered a race condition in the refresh token rotation. If a user made two simultaneous requests with an expired access token, both would try to use the refresh token. The first would succeed and rotate the token. The second would fail because the token was already used. Solution: Add a 1-second grace period for refresh token rotation.

---

### Week 15-16: Documentation

**What I documented:**
- API documentation (every endpoint)
- Setup guide (how to run locally)
- Deployment guide (how to deploy to production)
- Architecture decisions (why I made certain choices)
- Security considerations (what to watch out for)
- Extension guide (how to add features)

**Time spent:** 10 days

**The realization:**
Good documentation takes as long as writing the code. Maybe longer.

---

## The Final Count

**Total time:** 3 months (12 weeks)  
**Total lines of code:** 15,000+  
**Total commits:** 487  
**Total cups of coffee:** Too many to count  
**Total "this should be easy" moments that weren't:** 23

**Features implemented:**
- ✅ Email/password authentication
- ✅ Email verification
- ✅ Password reset
- ✅ OAuth (Google, GitHub, Twitter)
- ✅ Two-factor authentication (TOTP)
- ✅ Magic links
- ✅ Passwordless OTP
- ✅ Session management
- ✅ Rate limiting
- ✅ Security hardening
- ✅ Comprehensive error handling
- ✅ Full test coverage
- ✅ Complete documentation

---

## What I Learned

### 1. Authentication is an Iceberg

What you see (login form) is 5% of the work. The other 95% is:
- Edge cases
- Security considerations
- Error handling
- Recovery flows
- Session management
- Rate limiting
- Testing
- Documentation

### 2. Every Feature Touches Everything

Adding 2FA wasn't just adding 2FA. It was:
- Modifying the login flow
- Updating session management
- Changing token structure
- Adding recovery flows
- Updating all OAuth providers
- Rewriting tests
- Updating documentation

### 3. Security and UX are Constantly at Odds

Every decision is a trade-off:
- Longer token expiry = better UX, worse security
- Shorter token expiry = better security, worse UX
- Strict rate limiting = better security, frustrated users
- Loose rate limiting = better UX, vulnerable to attacks

### 4. The Hidden Complexity Tax

After building this, I finally understood why auth services charge premium prices. The value isn't in the happy path—it's in handling the 23 "this should be easy" edge cases that each take a day to solve correctly.

**The real revelation:** The code itself took 3 months. But understanding *why* each decision matters—that knowledge is permanent. It applies to every future project. That's the hidden ROI no pricing calculator captures.

*Curious about the actual cost savings?* I broke down the complete [financial analysis of Auth0 vs. custom auth](/blog/why-i-built-my-own-auth) with 5-year projections.

---

## Why I'm Sharing This

I spent 3 months building this so you don't have to.

**StackInsight Auth Pro** is the complete, production-ready authentication system I wish I had when I started. It includes:

- ✅ Everything I built (all features above)
- ✅ Angular 20 frontend (fully responsive, beautiful UI)
- ✅ Node.js/Express backend (TypeScript, fully typed)
- ✅ PostgreSQL database (Prisma ORM)
- ✅ Docker setup (one command to run everything)
- ✅ Deployment guides (Vercel, Render, Neon)
- ✅ Complete documentation (every decision explained)
- ✅ Test suite (87% coverage)

**More importantly:**
- ✅ All the edge cases handled
- ✅ All the security considerations addressed
- ✅ All the mistakes already made (and fixed)
- ✅ All the lessons learned (and documented)

---

## What This Journey Taught Me

Building authentication from scratch isn't just about writing code. It's about understanding the **why** behind every security decision:

- Why refresh tokens need rotation (prevent token replay attacks)
- Why temporary tokens need strict expiry (limit damage from interception)
- Why rate limiting must be granular (prevent brute force without blocking legitimate users)
- Why email deliverability matters (security is useless if users never get the verification)
- Why 2FA recovery needs multiple paths (avoid permanent lockouts)

This knowledge doesn't just apply to auth—it shapes how you think about security across your entire application.

**The bottom line:** You can use Auth0 and save time. Or you can build your own and gain understanding. Both are valid choices with different trade-offs.

*Need help deciding?* Read the [complete cost analysis and decision framework](/blog/why-i-built-my-own-auth) comparing Auth0, Clerk, and custom auth.

---

## Ready to Skip the 3-Month Journey?

**StackInsight Auth Pro** gives you everything I built, fully documented and ready to deploy.

**What you get:**
- Complete source code (15,000+ lines)
- Angular 20 frontend
- Node.js/Express backend
- All authentication methods (email, OAuth, 2FA, magic links, passwordless)
- Session management
- Rate limiting
- Security hardening
- Docker setup
- Deployment guides
- Lifetime updates

**What you save:**
- 3 months of development time
- Countless hours debugging edge cases
- Weeks of security research
- Days of documentation writing
- The frustration of "this should be easy"

**Start building your SaaS today, not in 3 months.**

👉 **[Get StackInsight Auth Pro at stackinsight.app](https://stackinsight.app)**

---

## Final Thoughts

Authentication is hard. Really hard. Harder than it should be.

But it doesn't have to be hard for you.

I spent 3 months in the trenches so you could spend 1 day setting up production-ready auth and get back to building what makes your SaaS unique.

**The question isn't "Can I build auth?"**  
**The question is "Should I spend 3 months building auth?"**

I did. You don't have to.

---

**Happy building,**  
— Ko-Hsin Liang

*Follow me on GitHub: [@liangk](https://github.com/liangk)*  
*Follow me on Twitter: [@stackinsightDev](https://x.com/StackInsightDev)*

---

### Found this story helpful?

Share it with other developers who are considering building auth from scratch. Sometimes the best way to learn is from someone else's 3-month journey.

**Star the repo** | **Share on Twitter** | **Subscribe for more real-world dev stories**
