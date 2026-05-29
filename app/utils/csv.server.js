import Papa from "papaparse";

/**
 * Normalize a price string.
 * Handles:
 *   "4.03"      -> 4.03
 *   "4,03"      -> 4.03
 *   "4,03 €"    -> 4.03
 *   "$1,234.56" -> 1234.56
 *   "1.234,56"  -> 1234.56  (European thousands+decimal)
 *   ""          -> null
 * Returns a number (with 2 decimal precision) or null if invalid.
 */
export function normalizePrice(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Strip everything except digits, commas, dots, and minus signs.
  s = s.replace(/[^\d,.\-]/g, "");

  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Whichever appears LAST is the decimal separator.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // European style: "1.234,56" -> dot is thousands sep, comma is decimal
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // US style: "1,234.56" -> comma is thousands sep
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // Only commas. If it looks like a thousands separator ("1,234"), strip.
    // If it looks like a decimal ("4,03"), convert to dot.
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // Treat as decimal
      s = parts[0] + "." + parts[1];
    } else {
      // Thousands separator
      s = s.replace(/,/g, "");
    }
  }
  // else: only dot or no separator — leave as-is

  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  // Round to 2 decimal places to avoid floating-point drift.
  return Math.round(n * 100) / 100;
}

/**
 * Normalize a SKU.
 * - Trim whitespace
 * - Strip trailing dots (Excel sometimes adds them to numeric strings)
 *   "00012." -> "00012"
 * - Returns null for empty values.
 */
export function normalizeSku(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip trailing dots
  s = s.replace(/\.+$/, "");
  if (!s) return null;
  return s;
}

/**
 * Find the SKU column and Price column from CSV headers.
 * Accepts variations like "SKU", "sku", "Sku", "VIP Price", "vip_price", "price".
 */
function pickColumns(headers) {
  const norm = (h) => String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const map = {};
  headers.forEach((h, i) => {
    map[norm(h)] = i;
  });

  const skuKeys = ["sku", "skus", "variantsku"];
  const priceKeys = ["vipprice", "price", "wholesaleprice", "vip"];

  let skuIdx = -1;
  for (const k of skuKeys) {
    if (k in map) { skuIdx = map[k]; break; }
  }
  let priceIdx = -1;
  for (const k of priceKeys) {
    if (k in map) { priceIdx = map[k]; break; }
  }
  return { skuIdx, priceIdx };
}

/**
 * Parse a CSV string into normalized rows.
 * Last row wins for duplicate SKUs.
 *
 * Returns:
 *   {
 *     rows: [{ sku, vipPrice }],
 *     errors: [{ line, message }],
 *     duplicateCount,
 *   }
 */
export function parseVipPriceCsv(csvText) {
  const result = Papa.parse(csvText, {
    skipEmptyLines: true,
  });

  const errors = [];
  if (!result.data || result.data.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "Empty CSV" }], duplicateCount: 0 };
  }

  const [headerRow, ...dataRows] = result.data;
  const { skuIdx, priceIdx } = pickColumns(headerRow);

  if (skuIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "Missing SKU column. Expected a column called 'SKU'." }],
      duplicateCount: 0,
    };
  }
  if (priceIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "Missing VIP Price column. Expected 'VIP Price' or 'Price'." }],
      duplicateCount: 0,
    };
  }

  // Map keeps insertion order, so we just overwrite on duplicate keys.
  const map = new Map();
  let duplicateCount = 0;

  dataRows.forEach((row, idx) => {
    const lineNumber = idx + 2; // +1 for header, +1 for 1-indexing
    const rawSku = row[skuIdx];
    const rawPrice = row[priceIdx];

    const sku = normalizeSku(rawSku);
    const vipPrice = normalizePrice(rawPrice);

    if (!sku) {
      errors.push({ line: lineNumber, message: `Empty SKU` });
      return;
    }
    if (vipPrice === null) {
      errors.push({ line: lineNumber, message: `Invalid price for SKU ${sku}: "${rawPrice}"` });
      return;
    }

    if (map.has(sku)) {
      duplicateCount++;
    }
    // Last write wins
    map.set(sku, { sku, vipPrice });
  });

  return {
    rows: Array.from(map.values()),
    errors,
    duplicateCount,
  };
}
