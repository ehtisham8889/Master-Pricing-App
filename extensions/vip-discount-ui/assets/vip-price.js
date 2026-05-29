/*
 * VIP Price — variant change listener
 *
 * The Liquid block emits a <script type="application/json" data-vip-variants="{productId}">
 * containing per-variant pricing data. This script:
 *   1. Reads that JSON on load.
 *   2. Listens for variant changes from multiple sources (Dawn's `variant:change`
 *      custom event, Shopify section rendering API, native select / radio inputs,
 *      and ?variant= URL changes).
 *   3. Recomputes the displayed VIP price, strikethrough, and savings for the
 *      newly-selected variant without a page reload.
 *
 * If the new variant has no VIP price (or VIP >= normal), the entire block is
 * hidden — the customer simply sees the theme's regular price.
 *
 * All formatting uses the `*_money` strings pre-rendered by Liquid so the
 * currency and locale exactly match the theme.
 */
(function () {
  'use strict';

  if (window.__vipPriceInitialized) return;
  window.__vipPriceInitialized = true;

  // ----------------------------------------------------------------------
  // Index every block on the page by product id
  // ----------------------------------------------------------------------
  function indexBlocks() {
    var index = {};
    var blocks = document.querySelectorAll('[data-vip-price-block]');
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var productId = block.getAttribute('data-product-id');
      if (!productId) continue;

      var dataNode = document.querySelector(
        'script[data-vip-variants="' + productId + '"]'
      );
      if (!dataNode) continue;

      var parsed = null;
      try {
        parsed = JSON.parse(dataNode.textContent || '{}');
      } catch (e) {
        // Malformed JSON — skip this block silently.
        continue;
      }

      index[productId] = {
        block: block,
        data: parsed,
      };
    }
    return index;
  }

  var blockIndex = indexBlocks();
  if (Object.keys(blockIndex).length === 0) return;

  // On initial load, hide theme price for any block already showing VIP price
  for (var pid in blockIndex) {
    var entry = blockIndex[pid];
    if (entry.block.getAttribute('data-vip-active') === 'true') {
      hideThemePrice(entry.block, true);
    }
  }

  // ----------------------------------------------------------------------
  // Update a block for a given variant id
  // ----------------------------------------------------------------------
  function applyVariant(productId, variantId) {
    var entry = blockIndex[productId];
    if (!entry) return;

    var data = entry.data;
    var block = entry.block;
    var container = block.querySelector('.vip-price-block__container');
    if (!container) return;

    var variants = data.variants || {};
    var v = variants[String(variantId)];

    // No data for this variant, or no VIP price set, or VIP >= normal: hide.
    if (!v || v.vip == null || parseFloat(v.vip) <= 0 ||
        parseFloat(v.vip) >= parseFloat(v.normal)) {
      container.style.display = 'none';
      block.removeAttribute('data-vip-active');
      block.setAttribute('data-current-variant-id', String(variantId));
      hideThemePrice(block, false);
      return;
    }

    var priceEl = block.querySelector('[data-vip-price]');
    var strikeEl = block.querySelector('[data-vip-strike]');
    var savingsEl = block.querySelector('[data-vip-savings]');
    var labelEl = block.querySelector('[data-vip-label]');

    if (priceEl) priceEl.textContent = v.vip_money || '';
    if (strikeEl) strikeEl.textContent = v.normal_money || '';

    if (savingsEl) {
      var saving = parseFloat(v.normal) - parseFloat(v.vip);
      var savingMoney = formatLikeMoney(saving, v.normal_money, v.vip_money);
      var prefix = (data.labels && data.labels.savings) || '';
      savingsEl.textContent = (prefix ? prefix + ' ' : '') + savingMoney;
    }

    if (labelEl && data.labels && data.labels.label) {
      labelEl.textContent = data.labels.label;
    }

    container.style.display = '';
    block.setAttribute('data-vip-active', 'true');
    block.setAttribute('data-current-variant-id', String(variantId));
    hideThemePrice(block, true);
  }

  /**
   * Format `amount` (in major units, e.g. 4.03) using the same currency
   * decoration the theme used for the reference money strings. We extract
   * the prefix/suffix around the digits and reuse them, so a theme rendering
   * "€4,03" continues to render savings as "€1,57".
   */
  function formatLikeMoney(amount, normalMoney, vipMoney) {
    var ref = vipMoney || normalMoney || '';
    var digitMatch = ref.match(/[\d.,]+/);
    if (!digitMatch) return amount.toFixed(2);

    var digits = digitMatch[0];
    var prefix = ref.slice(0, digitMatch.index);
    var suffix = ref.slice(digitMatch.index + digits.length);

    // Detect decimal separator used by the theme
    var usesComma = digits.lastIndexOf(',') > digits.lastIndexOf('.');
    var formatted = amount.toFixed(2);
    if (usesComma) formatted = formatted.replace('.', ',');

    return prefix + formatted + suffix;
  }

  // ----------------------------------------------------------------------
  // Detect which product on the page is currently being interacted with
  // ----------------------------------------------------------------------
  function findProductIdForElement(el) {
    if (!el || !el.closest) return null;

    // 1. Look for a vip-price-block ancestor or sibling within a product form
    var form = el.closest('form[action*="/cart/add"]');
    if (form) {
      // Find the nearest vip-price-block in the same product section
      var section = form.closest('section, .shopify-section, [data-section-id]') || document;
      var blk = section.querySelector('[data-vip-price-block]');
      if (blk) return blk.getAttribute('data-product-id');
    }

    // 2. Fall back to the first block on the page (single-product page case)
    var anyBlock = document.querySelector('[data-vip-price-block]');
    return anyBlock ? anyBlock.getAttribute('data-product-id') : null;
  }

  // ----------------------------------------------------------------------
  // Variant id extraction strategies
  // ----------------------------------------------------------------------

  // Dawn / many OS2 themes dispatch a `variant:change` CustomEvent
  document.addEventListener('variant:change', function (e) {
    var v = e.detail && (e.detail.variant || e.detail);
    if (!v) return;
    var variantId = v.id || v.variantId;
    if (!variantId) return;
    var productId = (e.detail && e.detail.productId) ||
                    findProductIdForElement(e.target);
    if (productId) applyVariant(productId, variantId);
  });

  // The variant selector usually lives inside a <variant-selects> custom
  // element. When the user picks an option, the form's hidden `id` input
  // is updated. We listen for `change` on that input.
  document.addEventListener('change', function (e) {
    var target = e.target;
    if (!target) return;

    // Hidden input[name="id"] inside a product form
    if (target.matches && target.matches('form[action*="/cart/add"] input[name="id"], form[action*="/cart/add"] select[name="id"]')) {
      var productId = findProductIdForElement(target);
      if (productId) applyVariant(productId, target.value);
      return;
    }

    // Radios / selects representing option1/option2/option3 within a product form
    if (target.matches && target.matches('form[action*="/cart/add"] [name^="option"], form[action*="/cart/add"] [name="options[]"]')) {
      // Give the theme a tick to update the hidden id input, then read it.
      window.setTimeout(function () {
        var form = target.closest('form[action*="/cart/add"]');
        if (!form) return;
        var idInput = form.querySelector('[name="id"]');
        if (!idInput) return;
        var productId = findProductIdForElement(form);
        if (productId) applyVariant(productId, idInput.value);
      }, 50);
    }
  }, true);

  // ----------------------------------------------------------------------
  // ?variant=XXX URL changes (PJAX / history.pushState)
  // ----------------------------------------------------------------------
  function readVariantFromUrl() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get('variant');
    } catch (e) {
      return null;
    }
  }

  function reapplyFromUrl() {
    var variantId = readVariantFromUrl();
    if (!variantId) return;
    var productIds = Object.keys(blockIndex);
    if (productIds.length === 1) {
      applyVariant(productIds[0], variantId);
    }
  }

  window.addEventListener('popstate', reapplyFromUrl);

  // Patch pushState/replaceState to catch SPA-style theme navigation
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function () {
    var r = origPush.apply(this, arguments);
    reapplyFromUrl();
    return r;
  };
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments);
    reapplyFromUrl();
    return r;
  };

  // ----------------------------------------------------------------------
  // Shopify Section Rendering API: when the theme re-renders the product
  // section after a variant change, our block may be re-mounted. Re-index.
  // ----------------------------------------------------------------------
  document.addEventListener('shopify:section:load', function () {
    blockIndex = indexBlocks();
    reapplyFromUrl();
  });

  // ----------------------------------------------------------------------
  // Hide / restore the theme's regular price element when VIP is active.
  // Tries several common selectors used by Dawn and other OS2 themes.
  // ----------------------------------------------------------------------
  function hideThemePrice(block, hide) {
    // Walk up to the nearest product section container
    var section = block.closest('[data-section-type], .shopify-section, section, .product__info-wrapper, .product-info') || document;
    var selectors = [
      '.price',
      '.price--main',
      '.product__price',
      '.price-item--regular',
      '.product-info__price',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var els = section.querySelectorAll(selectors[s]);
      for (var e = 0; e < els.length; e++) {
        // Don't touch elements inside our own block
        if (block.contains(els[e])) continue;
        els[e].style.display = hide ? 'none' : '';
      }
    }
  }

  // ----------------------------------------------------------------------
  // Initial pass — make sure what's rendered matches ?variant= on load.
  // ----------------------------------------------------------------------
  reapplyFromUrl();
})();
