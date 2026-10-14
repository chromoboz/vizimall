# Customer storefront setup

## Deployment

The existing Netlify project should use `netlify.toml`: build `node build.mjs`, publish `dist`, functions `.generated/functions`. The root `backend-*.mjs` files contain the server implementation; the build places the entry point in the functions folder and helper modules outside it. Netlify installs the three registry dependencies in package.json. Only browser assets are published. Existing public Storefront API configuration and country/store routing are preserved.

The current local environment cannot download npm packages. Local pure business/API tests use a deterministic in-memory adapter, not real customer data; deployment must additionally verify Netlify dependency installation, real Blobs conditional writes and photo re-encoding.

## Shopify Customer Account API

Existing public client: `58b6b514-bc5e-4384-9a12-08347583d90d`.

Set callback URL `https://vizimall.com/api/callback`, JavaScript origin `https://vizimall.com`, logout URL `https://vizimall.com/account.html`. These settings were saved and the live email-code callback was verified on 3 October 2026. Native account fallback: `https://shopify.com/108550685006/account`. Keep the public client type. Customer read and order read permissions are required. Name changes use the existing authenticated Customer Account API write scope. Address changes and return/cancellation requests use Shopify's existing customer portal.

Tokens remain server-side in private, encrypted Netlify Blobs. Browser cookies are Secure/HttpOnly and contain opaque random identifiers. OAuth uses PKCE, one-use state, browser binding and verified issuer/audience/signature/nonce. Session expiry requires fresh sign-in. No refresh token, Admin token or customer password is stored in the browser.

Blobs are site-scoped, strongly consistent and in Frankfurt. Production and deploy previews use separate namespaces. Existing Netlify credits pay for functions/storage/traffic: this is not a claim of unlimited free service.

## Moderation and support ownership

Set Functions environment variable `VIZIMALL_MODERATOR_CUSTOMER_IDS` to the owner's authenticated Shopify customer ID, e.g. `gid://shopify/Customer/123`, or `VIZIMALL_MODERATOR_CUSTOMER_EMAILS` to the owner's verified Shopify account email. Identity comes from the authenticated Shopify API, never a request body, arbitrary client parameter or browser-stored admin flag. Unconfigured moderation fails closed: reviews remain pending and customer support requests remain saved. Owner uses the account screen's moderation/support inbox. No customer email is sent by this implementation.

All submissions need an authenticated customer and verified paid purchase of the product. One canonical review exists per customer/product. Stars plus text are one review event; up to three photo uploads add a single optional bonus. All ratings are treated equally. Reviews are pending until reviewed for spam and private information. JPEG/PNG uploads are decoded/re-encoded, resized and stripped of location metadata. Edits replace photos and reset moderation. Withdrawals hide the review and clear its photos.

Account access and review submission refresh the user's own order/refund state. Coin reconciliation is idempotent with atomic compare-and-swap updates, an event ledger, and reversals. Published reviews become ineligible when the customer next accesses their account after a cancellation/full product refund. **There is no automatic background refund webhook yet.** Thus immediate invalidation while the customer is offline is not claimed. Redemption remains disabled. Before enabling economic rewards, implement a trusted order/refund event source and verify its processing.

## VIZI Coin proposal — not active

- Earn 10 coins per €1 of eligible paid EUR purchases after delivery costs and tax; refunds are conservatively subtracted in full. Coins round down; cancellations/unpaid orders earn zero.
- One approved verified review (stars plus at least 20 characters): 25 coins. With one or more approved customer photos: total 50 coins, not 50 per photo. Any rating qualifies equally.
- 1000 coins = €1; example milestones 1000/2000/5000 coins = €1/€2/€5.
- Proposed redemption requires at least €30 eligible basket value, is capped at 5% of eligible merchandise, and excludes shipping/taxes. Redemption cannot currently issue a discount. Earn starts only on the explicitly selected activation date; historical orders are not automatically rewarded.
- Shopping alone costs at most 1% of eligible sales if every awarded coin is redeemed. A photo review costs €0.05; a €40 eligible order plus that review would imply €0.45 reward cost, 1.125% of eligible sales. This excludes operating costs and assumes the conversion above; actual product margins remain unverified.
- Coins are non-transferable, have no cash value and are not a financial instrument. Incentivized reviews display a disclosure.

## Required live verification

1. Production build succeeds and private source/credentials are not served.
2. Shopify email-code login succeeds through the configured callback; logout clears the session and Shopify login. Other-origin POST, expired/replayed state, invalid token signatures fail.
3. Account A cannot access account B's orders, pending photos, favourites or tickets. Native profile/address changes persist.
4. Account empty state is truthful; existing orders show Shopify details and real carrier links. Return/cancellation availability follows Shopify policy, not fabricated promises.
5. A real paid order permits a pending written/photo review. An unpaid/unrelated/refunded product does not. Owner can publish a negative review. Edit resubmits; withdrawal hides it.
6. Photos reject SVG, oversized and malformed images; published images contain no EXIF/GPS. Customer/owner support replies persist without outgoing emails.
7. Country tags, variant photos, stock and guest checkout continue to work. Search/filter sorting covers all paginated products and favourites open the correct country/store.
8. VIZI Coin remains inactive with no made-up balance/discounts. Test the chosen active policy against paid, refunded, cancelled, repeat and concurrent events before activation.

The user and friends will perform real purchases after technical preparation. No order or payment is placed on their behalf. Company registration, payment-provider onboarding, legal policy/contact details and marketing remain outside the completed technical checks.
# Cookie preferences, measurement and email consent (3 October 2026)

The later user instruction postpones payments, company details and commercial policies. Do not change those settings or request details in this phase.

All public pages load `consent.js` and `consent.css`. Optional measurement is off by default; accept and reject are equally accessible, management remains in the footer, withdrawal clears the tab identifier and stops further requests. Choice/version/time stays locally for 180 days. There are no advertising pixels. Necessary account, cart and country storage still works after rejection.

`backend-audience.mjs` stores only consented daily browser-tab sessions and page-category views in private Frankfurt Blobs. This is an estimate of consenting sessions, not all people or all visits. No account/email/referrer/query/raw IP/fingerprint enters analytics records. Session events deduplicate with CAS. Security request limits hash IP separately; records expire with daily retention. Existing hosting requests still use plan credits; no paid analytics add-on was enabled.

`newsletter.html` first asks for Shopify email-code verification, then a separate unchecked marketing checkbox. Backend uses the authenticated Customer Account API email, never a submitted guest email. This is verified-email signup followed by explicit consent, not a second marketing confirmation email and not automatic account subscription. No email is sent and no campaign or new provider is configured. Consent record includes exact text/version/time/source. Unsubscribe works in the signed account or with an opaque token link (fragment stripped from URL, explicit POST confirmation; GET never changes consent). Owner-only account dashboard exports the freshly fetched active list, with per-recipient unsubscribe links. There is no automatic Shopify marketing synchronization. A future sender must apply the current suppression list and include unsubscribe links before every campaign.

Daily `retention` function is generated during production builds only; previews cannot clean production records. It removes expired measurement records after 31 days and expired security/login/session records. Withdrawn newsletter contact details are removed after 31 days, retaining only hashed email/status/date for suppression. Active consent stays until withdrawal or a deletion request. Before commercial launch finalize operator identity and review the full policies; the website notice is not a claim that all business/legal requirements are complete.

Validated by `node --test audience.test.mjs customer.test.mjs storefront-api.test.cjs`: 27 tests including pre-consent blocking, rejection/reload/withdrawal, origin protection, unverified registration denial, trusted-email binding, deduplication and retention.

## Profile and scrolling (3 October 2026)

`profile.js/css`, `backend-profile.mjs` and six local SVG presets add a separate profile editor. Name changes bind to the signed-in Shopify customer token, using customerUpdate; client-submitted customer IDs are ignored. First name and last initial in the header are derived from actual Shopify names. No example name is written to production. Avatars and optional JPEG/PNG photos are stored under hashed customer keys in private Blobs and returned only through the authenticated own-photo endpoint, without caching. Uploaded images are decoded, resized to 512px and re-encoded without EXIF/GPS; SVG and oversized/malformed uploads are rejected. Selecting an avatar replaces the uploaded photo.

The profile back arrow accepts only same-origin mall/store/map paths and active countries. All existing orders/reviews/favourites/support/owner tabs remain available. Cart moves to the document bottom-right; cookie height keeps it clear of the banner. Home uses normal document scrolling. Mall layout releases the fixed-body lock, and touch direction distinguishes vertical page movement from horizontal panorama dragging.

31 automated tests pass, including actual Sharp photo re-encoding, per-customer isolation, session-bound name writes and rejected foreign-origin mutations. Local browser tests verify name/photo persistence, account tabs, country-preserving back navigation, cart opening and real document scrolling. The browser viewport override did not take effect (actual viewport remained 1265 × 720); narrow-screen layout is implemented but actual mobile touch behavior must also be checked on a device. No real customer name was changed during tests.

## Mall-only layout correction (4 October 2026)

The later user instruction replaces the mall scroll behavior above: only `.mall-page` is now a fixed, full-viewport scene with vertical document movement disabled. Map, profile and product pages keep their scrolling. The injected footer is omitted on the mall; other pages retain Help/returns, privacy, email signup and Cookie preferences. First-visit cookie choice still runs on the mall, and later preference changes remain available on the profile/privacy pages. No consent state or tracking defaults changed.

The mall bag is a 46px icon button with an accessible item-count label and a nonzero count badge. On narrow screens the hint sits at bottom left; bag is bottom right with safe-area and cookie-panel clearance. Existing country/profile navigation and stock-checked checkout stay unchanged.

Checks: seven relevant audience tests passed; browser DOM/native interaction at 894×668 and 390×844 verified zero vertical scrolling, preserved horizontal movement, no footer, non-overlapping hint/bag and bag dialog opening. The 390px browser test is responsive layout and pointer input, not a physical phone touch test.
