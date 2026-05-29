# VIP Pricing — Custom Shopify App

A custom Shopify app that lets merchants charge **different prices per SKU** to logged-in customers tagged `vip`. VIP customers see the wholesale price on product pages, on collection pages, **and pay that price in cart and checkout**.

This is built with the **Shopify Remix app template**, a **JavaScript Shopify Function** for discount logic, a **Theme App Extension** for storefront display, **Prisma + SQLite** for session storage and job tracking, and **Polaris** for the admin UI.

---

## How it works

```
┌────────────────────────┐    ┌─────────────────────────┐    ┌──────────────────────────┐
│ Admin uploads CSV      │ →  │ Background job updates  │ →  │ custom.vip_price        │
│ (SKU, VIP Price)       │    │ variant metafields      │    │ metafield on every      │
│ in Polaris UI          │    │ in batches of 25        │    │ matched variant         │
└────────────────────────┘    └─────────────────────────┘    └──────────────────────────┘
                                                                       │
                                                                       ▼
┌──────────────────────────────────────┐         ┌───────────────────────────────────────┐
│ Theme App Extension (Liquid + JS)   │  ←─→    │ Shopify Function (Discount API, JS)   │
│ shows VIP price on product/         │         │ subtracts (normal - vip_price) per     │
│ collection pages to vip customers   │         │ line for customers tagged "vip"        │
└──────────────────────────────────────┘         └───────────────────────────────────────┘
```

The normal Shopify price stays the **public** price (so analytics, taxes, reporting all work normally). The VIP price overrides only at display time (for the theme) and at checkout time (for the function). Non-VIP customers never see a discount.

---

## Folder structure

```
shopify-vip-app/
├── app/                          ← Remix app (the admin UI)
│   ├── routes/
│   │   ├── _index.jsx            ← public landing → login or /app
│   │   ├── auth.$.jsx            ← OAuth flow
│   │   ├── auth.login.jsx        ← login form
│   │   ├── app.jsx               ← admin layout + nav
│   │   ├── app._index.jsx        ← admin home + recent jobs
│   │   ├── app.upload.jsx        ← CSV drag-drop, preview, Apply, live progress
│   │   ├── app.jobs.$jobId.jsx   ← polling endpoint for job status
│   │   ├── app.setup.jsx         ← one-click metafield + discount setup
│   │   ├── webhooks.app.uninstalled.jsx
│   │   └── webhooks.app.scopes_update.jsx
│   ├── utils/
│   │   ├── csv.server.js         ← SKU + price normalization, dedup
│   │   ├── graphql.server.js     ← all admin GraphQL queries/mutations
│   │   └── vipJob.server.js      ← background job processor (batches of 25, 500ms sleep)
│   ├── shopify.server.js
│   ├── db.server.js              ← Prisma singleton
│   ├── root.jsx
│   └── entry.server.jsx
├── extensions/
│   ├── vip-discount/             ← Shopify Function (JavaScript)
│   │   ├── shopify.extension.toml
│   │   ├── package.json
│   │   └── src/
│   │       ├── run.graphql       ← input query
│   │       └── cart_lines_discounts_generate_run.js
│   └── vip-discount-ui/          ← Theme App Extension
│       ├── shopify.extension.toml
│       ├── package.json
│       ├── blocks/
│       │   ├── vip-price.liquid        ← product page App Block
│       │   └── vip-price-card.liquid   ← collection card App Block
│       ├── snippets/
│       │   └── vip-price-collection.liquid
│       ├── assets/
│       │   ├── vip-price.css
│       │   └── vip-price.js
│       └── locales/
│           └── en.default.json
├── prisma/
│   └── schema.prisma             ← Session + VipPriceJob models
├── package.json
├── shopify.app.toml
├── shopify.web.toml
├── vite.config.js
├── remix.config.js
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

## Prerequisites (Windows)

You need **three** pieces of software installed system-wide before you can run anything: **Git**, **Node.js 20+**, and the **Shopify CLI**. Below is a complete walkthrough for Windows 10/11.

### 1. Install Git for Windows

1. Go to https://git-scm.com/download/win.
2. Download the 64-bit Git for Windows installer.
3. Run the installer. The defaults are fine. **Important checkboxes:**
   - "Git from the command line and also from 3rd-party software" (this puts `git` on your PATH).
   - "Use bundled OpenSSH" (default).
   - "Checkout as-is, commit Unix-style line endings" — recommended.
4. Open a **new** PowerShell window (not an old one — PATH won't refresh until you reopen) and verify:
   ```powershell
   git --version
   ```
   You should see something like `git version 2.45.0.windows.1`.

### 2. Install Node.js 20 or later

1. Go to https://nodejs.org/en/download.
2. Download the **Windows Installer (.msi)** for the LTS version (Node 20 or higher).
3. Run the installer. Defaults are fine. Leave "Automatically install necessary tools" checked **only if** you want native build tools — for this app you don't need them, you can uncheck it to save 20 minutes.
4. Open a new PowerShell window and verify both Node and npm:
   ```powershell
   node -v
   npm -v
   ```
   `node -v` must report `v20.` or higher.

### 3. Install Shopify CLI

The Shopify CLI is a global npm package. On Windows, you may need to run PowerShell **as Administrator** the first time so npm can write to the global folder.

```powershell
npm install -g @shopify/cli@latest
```

Verify:
```powershell
shopify version
```

You should see a version number like `3.x.y`. If `shopify` is not recognized, close and reopen PowerShell — npm's global bin folder needs to be picked up by the new shell.

### 4. (Recommended) Install Visual Studio Code

Not required, but heavily recommended: https://code.visualstudio.com/Download.

---

## Initial project setup

Clone or copy this project to a folder of your choice. Open PowerShell in that folder.

```powershell
# 1. Install dependencies (root + every extension)
npm install

# 2. Create your .env from the template and fill in values
copy .env.example .env

# 3. Generate the Prisma client and create the SQLite database
npx prisma generate
npx prisma migrate dev --name init
```

The Prisma migrate step creates `prisma/dev.sqlite` and runs your `Session` and `VipPriceJob` migrations.

### Linking the app to your Shopify Partners account

If this is a brand-new app:

```powershell
shopify app config link
```

The CLI will walk you through creating or selecting an app in your Partners dashboard and will write the resulting `client_id` into `shopify.app.toml`.

### Filling in `.env`

Open `.env` and fill in:

```
SHOPIFY_API_KEY=<copy from shopify.app.toml client_id>
SHOPIFY_API_SECRET=<from Partners > App > API credentials>
SHOPIFY_APP_URL=<leave blank for now; `shopify app dev` will fill this>
SCOPES=read_products,write_products,read_customers,read_discounts,write_discounts
DATABASE_URL="file:./prisma/dev.sqlite"
VIP_DISCOUNT_FUNCTION_ID=
```

`VIP_DISCOUNT_FUNCTION_ID` stays empty for now — you'll fill it in **after** deploying the function (see "Deploying" below).

---

## Running in development

```powershell
shopify app dev
```

The first time, the CLI will:
1. Ask which Partner organization to use.
2. Ask which store to install the app on (pick a **development store** — never a live store for testing).
3. Open your browser and prompt you to install the app on that store.
4. Start a tunnel (Cloudflare) and watch all your files.

Once the dev server is running:
- The admin UI is reachable from the Shopify admin under **Apps > VIP Pricing**.
- Changes to `app/**` hot-reload via Vite.
- Changes to the Shopify Function or Theme App Extension are picked up automatically by the CLI.

### Creating the metafield definition

Before uploading any prices:

1. In the admin, open the app and click **Setup Discount** in the left nav.
2. Click **Create metafield definition**. This calls Shopify's `metafieldDefinitionCreate` to register `custom.vip_price` on Product Variants, with storefront access set to **PUBLIC_READ** (required so the theme and the function can read it).
3. (Optional, but recommended) In the Shopify admin, go to **Settings > Custom Data > Variants** and confirm the `VIP Price` definition is there and pinned.

### Uploading prices

1. Click **Upload CSV** in the nav.
2. Drag a `.csv` file. The file must have at least two columns: one called `SKU` (case-insensitive variants like `sku`, `Variant SKU` also work) and one called `VIP Price` (variants like `vip_price`, `Price`, `Wholesale Price` also work).
3. The first 5 rows are previewed. Any parse errors (missing SKUs, invalid prices) show as warnings.
4. Click **Apply N prices**. A `VipPriceJob` record is created and the background processor starts immediately. The progress bar updates every 1.5 seconds via polling.
5. When the job finishes, the failure table lists any SKUs that couldn't be matched in Shopify or any per-batch errors.

#### CSV format details

| Column   | Example value | Notes                                                            |
|----------|---------------|------------------------------------------------------------------|
| SKU      | `00012`       | Trailing dots are stripped (`00012.` → `00012`).                |
| VIP Price| `4.03`        | Accepts `4.03`, `4,03`, `4,03 €`, `$1,234.56`, `1.234,56`.       |

Variants **not** in the CSV have their `vip_price` metafield **deleted** at the end of the job — the CSV is the source of truth.

Duplicate SKUs in the CSV: **the last row wins**.

---

## Deploying the function and theme extension

When you're ready to push extensions to Shopify so they actually run for customers:

```powershell
shopify app deploy
```

This creates a new **app version** that bundles the Remix code, the Discount Function, and the Theme App Extension. The CLI will prompt you to release the version — say yes for development stores, but for production you may want `--no-release` so you can release from the Partners dashboard after QA.

### Wiring up the automatic discount

After `shopify app deploy`, the function exists on the shop but isn't *active*. To activate it:

1. In the app's admin UI, go to **Setup Discount**.
2. Click **Find function**. The page lists all functions installed on the shop and highlights the VIP one.
3. Copy the function ID into your `.env` as `VIP_DISCOUNT_FUNCTION_ID=gid://shopify/Function/...` and restart `shopify app dev` (so the env var is picked up).
4. Click **Create automatic discount**. This calls `discountAutomaticAppCreate` to create a Shopify Automatic Discount of class `PRODUCT` that runs the VIP function on every cart.
5. Verify in the Shopify admin under **Discounts** — you should see an active "VIP Pricing" automatic discount.

You only do this **once per store**. If you re-deploy the function, the existing discount keeps pointing at the new version automatically.

### Activating the theme blocks

1. In the Shopify admin: **Online Store > Themes > Customize**.
2. On a product page, click **Add block** under the product information section. You should see "**Apps > VIP Price**". Add it where you want the VIP price to appear.
3. On a collection page (or wherever product cards render), click **Add block** under the product card section. Choose "**Apps > VIP Price (card)**".
4. Save the theme.

If your theme is vintage (non-OS2) or doesn't expose `@app` blocks in the section you want, you can `{% render 'vip-price-collection', product: product %}` directly from theme code as a fallback.

---

## Testing checklist

Run through this end-to-end before considering the app done. Use a **development store** with at least one product with multiple variants.

### 1. Metafield definition

- [ ] In the app, click **Setup > Create metafield definition**. Page reports success.
- [ ] In Shopify admin > **Settings > Custom Data > Variants**, the "VIP Price" definition exists.
- [ ] Click into the definition. Confirm:
  - Namespace: `custom`
  - Key: `vip_price`
  - Type: Money / Decimal
  - Storefront access: **Storefront** is checked (PUBLIC_READ).

### 2. CSV upload — happy path

- [ ] Prepare a CSV like:
  ```csv
  SKU,VIP Price
  TEST-SMALL,4.03
  TEST-MED,5,03
  TEST-LRG,"6,03 €"
  ```
- [ ] Upload via **Upload CSV**. Preview shows 3 unique SKUs, all prices normalized to `4.03 / 5.03 / 6.03`.
- [ ] Click Apply. Progress bar goes from 0% to 100%. Status badge: Pending → Running → Done.
- [ ] Open the variant for SKU `TEST-SMALL` in the Shopify admin. The Metafields section shows `custom.vip_price = 4.03`.
- [ ] Repeat for the other two SKUs.

### 3. CSV upload — edge cases

- [ ] Upload a CSV with a SKU that doesn't exist in Shopify. The job completes with status Done, the failures table lists `SKU not found in Shopify`.
- [ ] Upload a CSV with a SKU written as `00012.` (trailing dot). After import, the matched variant has SKU `00012`.
- [ ] Upload a CSV where a SKU appears twice with different prices. The metafield reflects the **last** row's price.
- [ ] Upload a CSV with 1000+ rows. Job completes without timing out. Total time roughly: `(rows / 25) × 0.5 seconds` for the sleep, plus GraphQL latency.

### 4. Deletion behavior

- [ ] After uploading the 3-SKU CSV above, upload a **different** CSV that contains only `TEST-SMALL,3.99`.
- [ ] When the job finishes, the report shows `Deleted (not in CSV): 2`.
- [ ] In the Shopify admin, `TEST-MED` and `TEST-LRG` variants no longer have a `vip_price` metafield. `TEST-SMALL` now has `3.99`.

### 5. Customer tagging

- [ ] In the Shopify admin, go to **Customers**. Create or pick a test customer.
- [ ] Add the tag `vip` (all lowercase). Save.
- [ ] Confirm by opening that customer's profile — tags list includes `vip`.

### 6. Theme display — anonymous visitor

- [ ] Open an incognito window and visit the storefront.
- [ ] Visit a product whose variant has a VIP price. **No** VIP block appears. The normal Shopify price is unchanged.
- [ ] Visit a collection page. No VIP badges appear next to product cards.

### 7. Theme display — VIP customer

- [ ] In the same incognito window, log in as the test customer with the `vip` tag.
- [ ] Visit the product. The VIP Price block now appears, showing the wholesale price, a strikethrough of the normal price, and the savings amount.
- [ ] Switch to a different variant (size, color, etc.). The displayed VIP price updates **without a page reload**. If the new variant has no `vip_price`, the block disappears entirely.
- [ ] Visit the collection page. The VIP price badge appears under the matching product cards.

### 8. Cart and checkout

- [ ] Still logged in as the VIP customer, add a VIP product to cart.
- [ ] On the cart page, the line shows a "VIP Price" discount that brings the price down to the VIP amount.
- [ ] Proceed to checkout. The "VIP Price" discount is applied automatically — no discount code needed. Order subtotal reflects the VIP price.
- [ ] Complete the order (use Shopify's test payment gateway — never a real card on a development store).
- [ ] Verify the order in the Shopify admin: the line item shows the discount with the label "VIP Price".

### 9. Cart and checkout — non-VIP customer

- [ ] Log out, log in as a different customer **without** the `vip` tag.
- [ ] Add the same product to cart. **No** discount is applied. Cart subtotal is the normal Shopify price.

### 10. Guard conditions

- [ ] In the admin, manually set a variant's `custom.vip_price` to a value **higher** than its normal price. Save.
- [ ] As a VIP customer, add that variant to cart. The function should **not** apply a discount (we never raise the price). The cart shows the normal price.

---

## Common operations cheatsheet

| Task                                          | Command                                        |
|-----------------------------------------------|------------------------------------------------|
| Start dev server                              | `shopify app dev`                              |
| Deploy a new version (function + theme + UI)  | `shopify app deploy`                           |
| Open Partners dashboard for this app          | `shopify app open`                             |
| Inspect environment variables on a store      | `shopify app env show`                         |
| Generate a new extension                      | `shopify app generate extension`               |
| List installed functions on a store           | `shopify app function list`                    |
| Run Prisma migration                          | `npx prisma migrate dev`                       |
| Reset the local database                      | `npx prisma migrate reset`                     |
| Open Prisma Studio (browse `VipPriceJob` rows)| `npx prisma studio`                            |

---

## Troubleshooting

**The VIP block doesn't appear in the theme editor "Add block" menu.**
You deployed the extension but haven't pushed an app version with `shopify app deploy` since. Run `shopify app deploy` and refresh the theme editor.

**The function is deployed but the cart never shows a VIP discount.**
You haven't created the **Automatic Discount** yet. Run the steps under "Wiring up the automatic discount" above. In the Shopify admin under **Discounts**, you should see a "VIP Pricing" automatic discount with status Active.

**The CSV upload reports "SKU not found" for all rows.**
Check that the SKUs in your CSV exactly match the SKUs on Shopify product variants. The matcher is case-sensitive. Trailing dots are stripped automatically, but other whitespace inside a SKU is preserved.

**The metafield definition creation says "Already exists".**
That's fine — the app treats `TAKEN` as success and reports success to the UI. You don't need to do anything.

**`npm install` fails on Windows with "EPERM" or "EACCES".**
Run PowerShell as Administrator the first time, or move the project to a folder under `C:\Users\<you>\` (not `C:\Program Files\` or similar).

**The dev tunnel URL changes every restart and breaks the install.**
That's normal for free Cloudflare tunnels. Run `shopify app dev` once, let it update the URLs automatically (the CLI does this for you because `automatically_update_urls_on_dev = true` is set in `shopify.app.toml`), and reinstall the app if Shopify shows "App is unavailable".

**The Theme App Extension shows but the variant change doesn't update the price.**
Open your browser DevTools, refresh the product page, and check that the `<script type="application/json" data-vip-variants="...">` tag is present and contains a `variants` object with entries for each variant. If it's missing, your theme's product section may not be re-rendering with the app block on initial load — try removing and re-adding the block from the theme editor.

---

## Important notes

- The metafield type used is `money_amount` (a plain decimal string). The Discount Function and the Liquid block both read it as a string and `parseFloat` / `plus: 0` it. If you change the type in `app.setup.jsx`, you must also change the corresponding parsing in `extensions/vip-discount/src/cart_lines_discounts_generate_run.js` and `extensions/vip-discount-ui/blocks/vip-price.liquid`.
- The Shopify Function is **JavaScript**, generated via the standard `shopify app generate extension` flow. The build is handled by the Shopify CLI's bundled ESBuild + Javy — there is **no manual build command** in `shopify.extension.toml`.
- The `shopify.extension.toml` for the function does **not** have an `[input.variables]` section because this function doesn't accept input variables. (Input variables are useful when the same function should behave differently per discount instance — e.g., different percentages — which isn't our case.)
- `@shopify/vite-plugin` is **not** a real npm package. The Remix template uses `@remix-run/dev`'s `vitePlugin` export directly, which is what `vite.config.js` does.
- The discount function returns `selectionStrategy: "FIRST"` with one candidate per cart line. Because each candidate has a unique `cartLine.id` target, all candidates are applied — that's how we get per-line VIP pricing.

---

## License

Private / internal use. No public license granted.
