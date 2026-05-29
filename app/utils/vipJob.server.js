import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import {
  VARIANTS_BY_SKU_QUERY,
  ALL_VARIANTS_WITH_VIP_PRICE_QUERY,
  METAFIELDS_SET_MUTATION,
  METAFIELDS_DELETE_MUTATION,
} from "./graphql.server.js";

// Rate-limit tuning
const BATCH_SIZE = 25;          // metafields per mutation
const SLEEP_MS = 500;            // sleep between batches
const SKU_LOOKUP_CHUNK = 25;     // SKUs per productVariants(query:) call

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * In-memory guard so the same job can't run twice in parallel.
 */
const runningJobs = new Set();

/**
 * Kick off the job processor in the background.
 * Returns immediately. Caller must NOT await.
 */
export function startJob(jobId, shop) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  processJob(jobId, shop)
    .catch(async (err) => {
      console.error(`[VipPriceJob ${jobId}] fatal error:`, err);
      await prisma.vipPriceJob.update({
        where: { id: jobId },
        data: {
          status: "error",
          errorMessage: err?.message?.slice(0, 1000) || "Unknown error",
        },
      });
    })
    .finally(() => {
      runningJobs.delete(jobId);
    });
}

async function processJob(jobId, shop) {
  const job = await prisma.vipPriceJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Job ${jobId} not found`);

  const rows = JSON.parse(job.payload);
  const total = rows.length;

  await prisma.vipPriceJob.update({
    where: { id: jobId },
    data: { status: "running", totalRows: total, processedRows: 0 },
  });

  const { admin } = await unauthenticated.admin(shop);

  // ------------------------------------------------------------------
  // STEP 1: Resolve SKU -> variantId by querying Shopify in chunks.
  // ------------------------------------------------------------------
  const skuToVariant = new Map();
  const failures = [];

  const skuList = rows.map((r) => r.sku);
  for (let i = 0; i < skuList.length; i += SKU_LOOKUP_CHUNK) {
    const chunk = skuList.slice(i, i + SKU_LOOKUP_CHUNK);
    const queryStr = chunk.map((s) => `sku:"${escapeQueryValue(s)}"`).join(" OR ");

    let cursor = null;
    let safety = 0;
    do {
      const resp = await admin.graphql(VARIANTS_BY_SKU_QUERY, {
        variables: { query: queryStr, cursor },
      });
      const json = await resp.json();
      const conn = json?.data?.productVariants;
      if (!conn) {
        // GraphQL error — log it for visible diagnostics
        throw new Error(
          `GraphQL error during variant lookup: ${JSON.stringify(json?.errors || json)}`
        );
      }
      for (const v of conn.nodes) {
        if (v.sku) skuToVariant.set(v.sku, v);
      }
      cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      safety++;
      if (safety > 50) break; // hard guard against runaway pagination
    } while (cursor);

    await sleep(150); // be gentle on the Admin API
  }

  // ------------------------------------------------------------------
  // STEP 2: Build the metafieldsSet payload and apply in batches of 25.
  // ------------------------------------------------------------------
  const toSet = [];
  const csvSkus = new Set();

  for (const row of rows) {
    csvSkus.add(row.sku);
    const variant = skuToVariant.get(row.sku);
    if (!variant) {
      failures.push({ sku: row.sku, message: "SKU not found in Shopify" });
      continue;
    }
    toSet.push({
      ownerId: variant.id,
      namespace: "custom",
      key: "vip_price",
      type: "number_decimal",
      value: row.vipPrice.toFixed(2),
    });
  }

  let successCount = 0;
  let processed = 0;

  for (let i = 0; i < toSet.length; i += BATCH_SIZE) {
    const batch = toSet.slice(i, i + BATCH_SIZE);
    try {
      const resp = await admin.graphql(METAFIELDS_SET_MUTATION, {
        variables: { metafields: batch },
      });
      const json = await resp.json();
      const errs = json?.data?.metafieldsSet?.userErrors || [];
      if (errs.length) {
        for (const e of errs) {
          // userErrors don't tell us which variant — log generally + per batch
          failures.push({
            sku: `(batch ${i / BATCH_SIZE + 1})`,
            message: `${e.code || ""} ${e.message}`.trim(),
          });
        }
      }
      const setOk = (json?.data?.metafieldsSet?.metafields || []).length;
      successCount += setOk;
    } catch (err) {
      for (const m of batch) {
        const sku = findSkuByVariantId(skuToVariant, m.ownerId);
        failures.push({ sku: sku || m.ownerId, message: err.message });
      }
    }

    processed += batch.length;
    await prisma.vipPriceJob.update({
      where: { id: jobId },
      data: { processedRows: Math.min(processed, total), successCount },
    });

    await sleep(SLEEP_MS);
  }

  // ------------------------------------------------------------------
  // STEP 3: Delete vip_price metafields for variants NOT in this CSV.
  // ------------------------------------------------------------------
  const toDelete = [];
  let cursor = null;
  let safety = 0;
  do {
    const resp = await admin.graphql(ALL_VARIANTS_WITH_VIP_PRICE_QUERY, {
      variables: { cursor },
    });
    const json = await resp.json();
    const conn = json?.data?.productVariants;
    if (!conn) break;
    for (const v of conn.nodes) {
      if (!v.sku) continue;
      if (csvSkus.has(v.sku)) continue;
      if (v.vipPrice && v.vipPrice.id) {
        toDelete.push({
          ownerId: v.id,
          namespace: "custom",
          key: "vip_price",
        });
      }
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    safety++;
    if (safety > 500) break;
  } while (cursor);

  let deletedCount = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    try {
      const resp = await admin.graphql(METAFIELDS_DELETE_MUTATION, {
        variables: { metafields: batch },
      });
      const json = await resp.json();
      const deleted = json?.data?.metafieldsDelete?.deletedMetafields || [];
      deletedCount += deleted.length;
      const errs = json?.data?.metafieldsDelete?.userErrors || [];
      for (const e of errs) {
        failures.push({ sku: "(delete-batch)", message: e.message });
      }
    } catch (err) {
      failures.push({ sku: "(delete-batch)", message: err.message });
    }
    await sleep(SLEEP_MS);
  }

  // ------------------------------------------------------------------
  // STEP 4: Mark done.
  // ------------------------------------------------------------------
  await prisma.vipPriceJob.update({
    where: { id: jobId },
    data: {
      status: "done",
      processedRows: total,
      successCount,
      failureCount: failures.length,
      deletedCount,
      failures: JSON.stringify(failures).slice(0, 1024 * 256), // cap at 256KB
    },
  });
}

function escapeQueryValue(v) {
  // Escape backslashes and double quotes for Shopify search syntax
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findSkuByVariantId(map, variantId) {
  for (const [sku, v] of map.entries()) {
    if (v.id === variantId) return sku;
  }
  return null;
}
