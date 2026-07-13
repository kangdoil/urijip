---
version: alpha
name: Clay-design-analysis
description: A vibrant claymation-meets-data interface for Clay.com (GTM data-orchestration platform). Anchors on a light neutral canvas with pink primary CTAs, Pretendard Variable typography, and saturated single-color feature cards — pink, teal, coral, and lavender — that punctuate long-scroll explainer pages. Brand voltage comes from 3D-rendered claymation illustrations (mountains, characters, mascots) used as full-bleed hero artifacts and the bright multi-color card surfaces showing product UI fragments.

colors:
  pink-50: "#FFF0F5"
  pink-100: "#FFE1E9"
  pink-200: "#FFC2D3"
  pink-300: "#FF99B3"
  pink-400: "#FF7096"
  pink-500: "#FF4D8B"
  pink-600: "#E63973"
  pink-700: "#C21A56"
  pink-800: "#8F0D3C"
  pink-900: "#400418"
  neutral-50: "#F8FAFC"
  neutral-100: "#F1F5F9"
  neutral-300: "#CBD5E1"
  neutral-500: "#64748B"
  neutral-900: "#0F172A"
  primary: "#FF4D8B"
  primary-active: "#E63973"
  primary-disabled: "#FFE1E9"
  ink: "#0F172A"
  body: "#64748B"
  body-strong: "#0F172A"
  muted: "#64748B"
  muted-soft: "#CBD5E1"
  hairline: "#CBD5E1"
  hairline-soft: "#F1F5F9"
  canvas: "#F8FAFC"
  surface-soft: "#F1F5F9"
  surface-card: "#F8FAFC"
  surface-strong: "#CBD5E1"
  surface-dark: "#0F172A"
  surface-dark-elevated: "#64748B"
  on-primary: "#0F172A"
  on-dark: "#F8FAFC"
  on-dark-soft: "#CBD5E1"
  brand-pink: "#FF4D8B"
  brand-teal: "#3EDAD8"
  brand-coral: "#FF8A71"
  brand-lavender: "#D0C3FF"
  success: "#3EDAD8"
  warning: "#FF8A71"
  error: "#E63973"

typography:
  display-xl:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 72px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: -2.5px
  display-lg:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 56px
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -2px
  display-md:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 40px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -1px
  display-sm:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -0.5px
  title-lg:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.3px
  title-md:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  title-sm:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-md:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  caption:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  caption-uppercase:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 1.5px
  button:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0
  nav-link:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 48px
  3xl: 60px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.3xl}"
    padding: 12px 20px
    height: 44px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.3xl}"
  button-primary-disabled:
    backgroundColor: "{colors.primary-disabled}"
    textColor: "{colors.muted}"
    rounded: "{rounded.3xl}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.3xl}"
    padding: 12px 20px
    height: 44px
  button-on-color:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.3xl}"
    padding: 12px 20px
    height: 44px
  button-text-link:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.button}"
  text-link:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    height: 64px
  hero-band:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
    padding: 96px
  hero-illustration-card:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.3xl}"
  feature-card-pink:
    backgroundColor: "{colors.brand-pink}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 32px
  feature-card-teal:
    backgroundColor: "{colors.brand-teal}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 32px
  feature-card-lavender:
    backgroundColor: "{colors.brand-lavender}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 32px
  feature-card-coral:
    backgroundColor: "{colors.brand-coral}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 32px
  feature-card-cream:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 32px
  product-mockup-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 24px
  testimonial-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.3xl}"
    padding: 24px
  pricing-tier-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-lg}"
    rounded: "{rounded.3xl}"
    padding: 32px
  pricing-tier-card-featured:
    backgroundColor: "{colors.brand-teal}"
    textColor: "{colors.on-dark}"
    typography: "{typography.title-lg}"
    rounded: "{rounded.3xl}"
    padding: 32px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.pill}"
    padding: 12px 16px
    height: 44px
  text-input-focused:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  category-tab:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  category-tab-active:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.pill}"
  badge-pill:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
  expert-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
    rounded: "{rounded.3xl}"
    padding: 24px
  cta-band-illustrated:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    rounded: "{rounded.3xl}"
    padding: 80px
  footer:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: 80px
---

## Overview

Clay.com is the most playful B2B SaaS interface in the GTM-data category. The base atmosphere is a **light neutral canvas** (`{colors.canvas}` — #F8FAFC) holding neutral-900 ink type and **3D-rendered claymation illustrations** (mountains, mascot characters, teal/coral/lavender landscapes) as the dominant brand voltage. Where most data-platform brands play it cool with grids and gradients, Clay leans hard into hand-crafted-looking 3D illustrations and saturated single-color feature cards.

Type voice runs **Pretendard Variable** across display, body, navigation, and UI. Display headings use weight 500 with negative letter-spacing; body and UI use the existing token weights. The display weight stays at 500, never bolder — its measured character keeps the page warm without needing extra weight.

Component voltage comes from **saturated single-color feature cards** in a 5-color palette: pink, teal, coral, lavender, and neutral-card. Each card shows product UI fragments at small scale — Claygent agent runs, sequencer flows, CRM enrichment outputs. The colored card IS the primary visual element on every long-scroll page.

**Key Characteristics:**
- Light neutral canvas (`{colors.canvas}` — #F8FAFC). The calm base lets the accent cards carry the visual energy.
- Pink primary CTAs (`{colors.primary}` — #FF4D8B). Buttons rounded `{rounded.3xl}` (60px) — a full capsule shape at button height.
- 5-color feature card palette: `{colors.brand-pink}`, `{colors.brand-teal}`, `{colors.brand-coral}`, `{colors.brand-lavender}`, `{colors.surface-card}` (neutral).
- 3D claymation illustrations (mountains, characters, abstract shapes) as full-bleed hero artifacts — the brand's most-recognized visual element.
- Pretendard Variable display type at 500 weight with -1 to -2.5px letter-spacing on display sizes.
- Border radius is generous: `{rounded.pill}` for search/text inputs, `{rounded.3xl}` (60px) for buttons and every content/feature card. The capsule-like radius matches the rounded display type's character.
- Product UI fragments embedded inside colored cards at small scale — agent run logs, sequencer flows, enrichment results.
- Section rhythm `{spacing.section}` (96px) between major bands.
- Footer is light neutral (`{colors.surface-soft}`) — Clay does NOT use a dark footer. Even the closing band stays light.

## Colors

### Palette
- **Pink scale:** `{colors.pink-50}` #FFF0F5 · `{colors.pink-100}` #FFE1E9 · `{colors.pink-200}` #FFC2D3 · `{colors.pink-300}` #FF99B3 · `{colors.pink-400}` #FF7096 · `{colors.pink-500}` #FF4D8B · `{colors.pink-600}` #E63973 · `{colors.pink-700}` #C21A56 · `{colors.pink-800}` #8F0D3C · `{colors.pink-900}` #400418.
- **Neutral scale:** `{colors.neutral-50}` #F8FAFC · `{colors.neutral-100}` #F1F5F9 · `{colors.neutral-300}` #CBD5E1 · `{colors.neutral-500}` #64748B · `{colors.neutral-900}` #0F172A.
- **Primary** (`{colors.primary}` — #FF4D8B): Primary CTA surface and emphasis.
- **Brand Pink** (`{colors.brand-pink}` — #FF4D8B): Outbound / sequencer feature card surface.
- **Brand Teal** (`{colors.brand-teal}` — #3EDAD8): Teal feature-card and success accent.
- **Brand Coral** (`{colors.brand-coral}` — #FF8A71): Warm feature-card and warning accent.
- **Brand Lavender** (`{colors.brand-lavender}` — #D0C3FF): Soft feature-card surface.

### Surface
- **Canvas** (`{colors.canvas}` — #F8FAFC): The default page floor.
- **Surface Soft** (`{colors.surface-soft}` — #F1F5F9): Footer and CTA-band background.
- **Surface Card** (`{colors.surface-card}` — #F8FAFC): Quiet feature cards and testimonial cards.
- **Surface Strong** (`{colors.surface-strong}` — #CBD5E1): Stronger neutral for emphasized bands.
- **Surface Dark** (`{colors.surface-dark}` — #0F172A): Dark neutral for occasional dark cards (rare).
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` — #64748B): Elevated dark-card treatment.
- **Hairline** (`{colors.hairline}` — #CBD5E1): 1px borders on cards and inputs.

### Text
- **Ink** (`{colors.ink}` — #0F172A): Headlines and primary text.
- **Body Strong** (`{colors.body-strong}` — #0F172A): Emphasized body, lead paragraphs.
- **Body** (`{colors.body}` — #64748B): Default running-text.
- **Muted** (`{colors.muted}` — #64748B): Sub-headings, breadcrumbs, footer body.
- **Muted Soft** (`{colors.muted-soft}` — #CBD5E1): Captions, fine-print.
- **On Primary** (`{colors.on-primary}` — #0F172A): Text on pink primary surfaces.
- **On Dark** (`{colors.on-dark}` — #F8FAFC): Text on dark neutral surfaces.

### Semantic
- **Success** (`{colors.success}` — #3EDAD8): Success states.
- **Warning** (`{colors.warning}` — #FF8A71): Warning callouts.
- **Error** (`{colors.error}` — #E63973): Validation errors.

## Typography

### Font Family
The system runs **Pretendard Variable** for headlines, body, navigation, and UI. Display headings use weight 500 with negative letter-spacing; body and UI use the token weights defined above. The fallback stack is `"Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 72px | 500 | 1.0 | -2.5px | Homepage h1 ("Go to market with unique data") — Pretendard Variable |
| `{typography.display-lg}` | 56px | 500 | 1.05 | -2px | Section heads — Pretendard Variable |
| `{typography.display-md}` | 40px | 500 | 1.1 | -1px | Sub-section heads, product names |
| `{typography.display-sm}` | 32px | 500 | 1.15 | -0.5px | CTA-band heads, feature card titles |
| `{typography.title-lg}` | 24px | 600 | 1.3 | -0.3px | Pricing plan names, larger feature titles |
| `{typography.title-md}` | 18px | 600 | 1.4 | 0 | Card titles, intro paragraphs |
| `{typography.title-sm}` | 16px | 600 | 1.4 | 0 | Small card titles, list labels |
| `{typography.body-md}` | 16px | 400 | 1.55 | 0 | Default running-text |
| `{typography.body-sm}` | 14px | 400 | 1.55 | 0 | Footer body, fine-print |
| `{typography.caption}` | 13px | 500 | 1.4 | 0 | Badge labels, captions |
| `{typography.caption-uppercase}` | 12px | 600 | 1.4 | 1.5px | Section labels, "FEATURED" badges |
| `{typography.button}` | 14px | 600 | 1.0 | 0 | Standard button labels |
| `{typography.nav-link}` | 14px | 500 | 1.4 | 0 | Top-nav menu items |

### Principles
Pretendard Variable at weight 500 + negative letter-spacing is the display voice. Going to weight 700 reads as bombastic; restraint keeps the large display hierarchy warm and measured.

The hierarchy comes from size, weight, and spacing rather than a font-family split: Pretendard Variable serves both display headlines and UI text through the defined tokens.

### Font Fallback
Prefer Pretendard Variable. When unavailable, use the system fallback stack defined above; do not introduce a second display family as a substitute.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- **Section padding:** `{spacing.section}` (96px) between major editorial bands.
- **Card internal padding:** `{spacing.xl}` (32px) for feature cards and pricing tiers; `{spacing.lg}` (24px) for testimonial and product mockup cards.

### Grid & Container
- **Max content width:** ~1280px centered.
- **Editorial body:** Single 12-column grid; hero often uses 7/5 split (h1 left, illustration right).
- **Feature card grids:** 3-up at desktop, 2-up at tablet, 1-up at mobile.
- **Pricing grid:** 3-4 up at desktop, 1-up at mobile.

### Whitespace Philosophy
Clay uses generous whitespace around big rounded display headlines and saturated feature cards. The neutral canvas + colored cards + 3D illustrations create a playful warmth that competing data-platform sites lack.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Body sections, top nav, hero |
| Soft hairline | 1px `{colors.hairline}` border | Inputs, small content cards |
| Saturated card | Brand pink/teal/coral/lavender fill — no shadow | Feature cards |
| Neutral card | `{colors.surface-card}` background — no shadow | Testimonial, secondary cards |
| Subtle drop shadow | Faint shadow at low alpha | Hover-elevated states (rare) |

The system uses no heavy shadows. Depth comes from the saturated color contrast between the neutral canvas and bright feature cards.

### Decorative Depth
- **3D claymation illustrations** — mountains, characters, mascots rendered in a hand-crafted 3D style. The brand's most-recognized depth element. Not a token — these are illustrated assets.
- **Mascot characters** appear as inline figures in feature cards and CTAs.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 6px | Small badges, dropdown items |
| `{rounded.sm}` | 8px | Small buttons, hairline-border accent |
| `{rounded.md}` | 12px | Legacy/minor UI accents |
| `{rounded.lg}` | 16px | Legacy secondary containers |
| `{rounded.xl}` | 24px | Legacy feature-card radius (superseded by `{rounded.3xl}`) |
| `{rounded.2xl}` | 48px | Large illustrated bands, oversized surfaces |
| `{rounded.3xl}` | 60px | All buttons, all content/feature cards — capsule radius |
| `{rounded.pill}` | 9999px | Search/text inputs, category tabs, badge pills |
| `{rounded.full}` | 9999px / 50% | Avatars, icon buttons |

## Components

### Top Navigation

**`top-nav`** — Light-neutral nav bar pinned to top. 64px tall, `{colors.canvas}` background. Carries the Clay logo + wordmark at left, primary horizontal menu (Product, Solutions, Resources, Pricing, Customers) center, right-side cluster with "Sign in" + "Try free" `{component.button-primary}`. Menu items use `{typography.nav-link}` (Pretendard Variable 14px / 500).

### Buttons

**`button-primary`** — Background `{colors.primary}` (pink), text `{colors.on-primary}` (light neutral), type `{typography.button}` (Pretendard Variable 14px / 600), padding 12px × 20px, height 44px, rounded `{rounded.3xl}` (60px — a full capsule at this height).

**`button-secondary`** — Light-neutral button with hairline outline. Background `{colors.canvas}`, text `{colors.ink}`, 1px hairline border, rounded `{rounded.3xl}` (60px, same capsule shape as primary).

**`button-on-color`** — White button used over saturated brand-color feature cards. Same shape as primary but inverted (white background, ink text).

**`button-text-link`** — Inline text button, no background. Used for "Sign in" and inline link CTAs.

**`text-link`** — Inline body links in `{colors.ink}` with underline.

### Cards & Containers

**`hero-band`** — Neutral-canvas hero with 7-5 grid: h1 + sub-headline + button row on the left, 3D claymation illustration on the right. Vertical padding `{spacing.section}` (96px).

**`hero-illustration-card`** — Right-side artifact holding 3D claymation illustration (mountains, mascot character, abstract shapes). Background `{colors.surface-soft}`, rounded `{rounded.3xl}` (60px). The illustration IS the artifact.

**`feature-card-pink`** / **`feature-card-teal`** / **`feature-card-coral`** / **`feature-card-lavender`** — Saturated single-color feature cards. Background varies per variant; rounded `{rounded.3xl}` (60px); padding `{spacing.xl}` (32px). Each card carries an h3 in `{typography.title-md}`, a body description, and a product UI fragment or mascot illustration. Text uses `{colors.ink}` on teal, coral, and lavender; pink uses `{colors.on-dark}` for contrast.

**`feature-card-cream`** — Lower-key feature card variant on `{colors.surface-card}`. Used for less-emphasized features that don't warrant a saturated color; its name is retained for compatibility, but the surface is neutral.

**`product-mockup-card`** — Card showing actual Clay product UI (Claygent agent runs, sequencer flows, CRM enrichment tables). Background `{colors.canvas}` with hairline border, rounded `{rounded.3xl}` (60px), padding `{spacing.lg}` (24px).

**`testimonial-card`** — Customer quote cards. Background `{colors.surface-card}` (neutral), rounded `{rounded.3xl}` (60px), padding `{spacing.lg}` (24px). Top row has avatar + name + role; below sits the testimonial in `{typography.body-md}`.

**`pricing-tier-card`** — Standard tier card. Background `{colors.canvas}` with hairline, rounded `{rounded.3xl}` (60px), padding `{spacing.xl}` (32px).

**`pricing-tier-card-featured`** — The featured tier flips to `{colors.brand-teal}` (teal), rounded `{rounded.3xl}` (60px) same as the standard tier. The teal surface is the featured signal.

**`expert-card`** — Used on /experts page. Background `{colors.canvas}` with hairline, rounded `{rounded.3xl}` (60px), padding `{spacing.lg}`. Carries an avatar at top, expert name, specialization, and a "Book session" link.

### Inputs & Forms

**`text-input`** — Background `{colors.canvas}`, text `{colors.ink}`, type `{typography.body-md}`, rounded `{rounded.pill}` (search fields and text inputs are fully pill-shaped), padding 12px × 16px, height 44px. 1px hairline border.

**`text-input-focused`** — Border thickens to ink for emphasis.

### Tabs / Badges

**`category-tab`** + **`category-tab-active`** — Pill-shaped tabs in sub-nav. Inactive: transparent + muted text. Active: neutral-card background + ink text. Padding 8px × 16px.

**`badge-pill`** — Small neutral-fill pill labels in `{typography.caption}` (13px / 500), rounded `{rounded.pill}`.

### CTA / Footer

**`cta-band-illustrated`** — Pre-footer "Turn your growth ideas into reality today" band. Background `{colors.surface-soft}`, rounded `{rounded.3xl}` (60px), padding 80px. Carries an h2 in `{typography.display-md}`, a sub-line, and a `{component.button-primary}` — usually paired with a 3D illustration of a mascot or scene.

**`footer`** — Light-neutral footer (NOT dark navy unlike most SaaS sites). Background `{colors.surface-soft}`, text `{colors.body}`. 4-column link list. Vertical padding 80px. Often features a horizon-style 3D mountain illustration at the very bottom — Clay's signature footer mountain.

## Do's and Don'ts

### Do
- Anchor every page on the neutral canvas (`{colors.canvas}` — #F8FAFC). The light base lets the accent palette carry the visual hierarchy.
- Use 3D claymation illustrations as hero artifacts. Hand-crafted 3D characters and mountains ARE the brand.
- Cycle saturated feature cards across the page — pink → teal → coral → lavender → neutral. Repeating the same color twice in a row reads as off-rhythm.
- Use Pretendard Variable at weight 500 with negative letter-spacing on every display headline.
- Show product UI fragments inside saturated feature cards. The brand voltage is product-driven, not abstract.
- Use a light-neutral footer (NOT dark). Clay deliberately closes pages with a light surface rather than the standard dark-footer SaaS template.
- Anchor every band with `{spacing.section}` (96px) vertical rhythm.

### Don't
- Don't introduce a canvas color outside the neutral scale.
- Don't use a 6th brand-color card. The 5-color palette is saturated enough.
- Don't bold display weight beyond 500. Pretendard Variable at 700 reads as bombastic.
- Don't repeat the same brand-color card twice in a row.
- Don't replace claymation illustrations with flat vector art. The hand-crafted 3D character IS the brand voice.
- Don't use a dark footer. The light-neutral footer is part of the system's pacing.
- Don't add hover state styling beyond what the system already encodes.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 768px | Hamburger nav; hero h1 72→36px; hero-illustration-card stacks below; feature grids 1-up; pricing 1-up |
| Tablet | 768–1024px | Top nav tightens; feature cards 2-up; pricing 2-up |
| Desktop | 1024–1440px | Full top-nav; 3-up feature cards; 3-up pricing tiers |
| Wide | > 1440px | Same as desktop with more breathing room; max content 1280px |

### Touch Targets
- `{component.button-primary}` at minimum 44 × 44px (matches WCAG AAA).
- `{component.text-input}` height is 44px.

### Collapsing Strategy
- Top nav collapses to hamburger at < 768px.
- Hero 7-5 grid → single-column on mobile.
- Feature card grids reduce columns rather than scaling.
- Saturated feature cards retain their colored fill at every breakpoint.
- Pricing tier cards collapse 4 → 2 → 1.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key (`{component.feature-card-pink}`, `{component.pricing-tier-card-featured}`).
2. Pick the right brand-color card for the feature: pink for outbound/sequencer, teal for enterprise/featured, lavender for AI-agent products, coral for general SaaS warmth, neutral for secondary content.
3. Variants of an existing component (`-active`, `-disabled`) live as separate entries.
4. Use `{token.refs}` everywhere — never inline hex.
5. Never document hover.
6. Display headlines stay Pretendard Variable 500 with negative letter-spacing. Body stays Pretendard Variable 400.
7. The light-neutral palette is a system contract — don't add a dark footer.

## Known Gaps

- Pretendard Variable must be available to the product runtime; use the defined system fallback stack only when it cannot be loaded.
- 3D claymation illustrations are commissioned assets, not system tokens — they're rendered per-page.
- The mascot characters (named characters that recur across the site) are illustrated assets; their exact lineage and naming are not formalized in tokens.
- Animation and transition timings (3D illustration parallax on scroll, feature card entrance animations) are not in scope.
- Form validation states beyond `{component.text-input-focused}` are not extracted.
- The actual Clay product surface (in-app data tables, formula editor, agent builder) shares some tokens with the marketing site but adds many product-specific components that are out of scope.
