import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  DropZone,
  Banner,
  DataTable,
  ProgressBar,
  Badge,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import { parseVipPriceCsv } from "../utils/csv.server.js";
import { startJob } from "../utils/vipJob.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const job = await prisma.vipPriceJob.findFirst({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return json({ activeJob: jobToJSON(job) });
};

function jobToJSON(j) {
  if (!j) return null;
  return {
    id: j.id,
    status: j.status,
    totalRows: j.totalRows,
    processedRows: j.processedRows,
    successCount: j.successCount,
    failureCount: j.failureCount,
    deletedCount: j.deletedCount,
    errorMessage: j.errorMessage,
    failures: JSON.parse(j.failures || "[]"),
    createdAt: j.createdAt.toISOString(),
  };
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "parse") {
    const csvText = String(form.get("csv") || "");
    const { rows, errors, duplicateCount } = parseVipPriceCsv(csvText);
    return json({
      ok: true,
      preview: rows.slice(0, 5),
      total: rows.length,
      duplicateCount,
      parseErrors: errors,
      csvText, // echo back so the client can submit it on Apply
    });
  }

  if (intent === "apply") {
    const csvText = String(form.get("csv") || "");
    const { rows, errors } = parseVipPriceCsv(csvText);
    if (rows.length === 0) {
      return json({ ok: false, error: "No valid rows to apply." }, { status: 400 });
    }
    const job = await prisma.vipPriceJob.create({
      data: {
        shop: session.shop,
        status: "pending",
        totalRows: rows.length,
        payload: JSON.stringify(rows),
        failures: JSON.stringify(errors), // pre-load parse-time errors
        failureCount: errors.length,
      },
    });
    // Fire-and-forget; do not await.
    startJob(job.id, session.shop);
    return json({ ok: true, jobId: job.id });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function UploadPage() {
  const { activeJob: initialJob } = useLoaderData();
  const parseFetcher = useFetcher();
  const applyFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const revalidator = useRevalidator();

  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [activeJobId, setActiveJobId] = useState(
    initialJob && (initialJob.status === "running" || initialJob.status === "pending")
      ? initialJob.id
      : null
  );
  const [job, setJob] = useState(initialJob);

  // ----- handle drop -----
  const handleDrop = useCallback((_files, accepted) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setCsvText(text);
      const fd = new FormData();
      fd.set("intent", "parse");
      fd.set("csv", text);
      parseFetcher.submit(fd, { method: "post" });
    };
    reader.readAsText(f);
  }, [parseFetcher]);

  // ----- apply -----
  const handleApply = useCallback(() => {
    if (!csvText) return;
    const fd = new FormData();
    fd.set("intent", "apply");
    fd.set("csv", csvText);
    applyFetcher.submit(fd, { method: "post" });
  }, [csvText, applyFetcher]);

  useEffect(() => {
    if (applyFetcher.data?.ok && applyFetcher.data.jobId) {
      setActiveJobId(applyFetcher.data.jobId);
    }
  }, [applyFetcher.data]);

  // ----- poll status -----
  useEffect(() => {
    if (!activeJobId) return undefined;
    const tick = () => {
      statusFetcher.load(`/app/jobs/${activeJobId}`);
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId]);

  useEffect(() => {
    if (statusFetcher.data?.job) {
      setJob(statusFetcher.data.job);
      if (statusFetcher.data.job.status === "done" || statusFetcher.data.job.status === "error") {
        setActiveJobId(null);
        revalidator.revalidate();
      }
    }
  }, [statusFetcher.data, revalidator]);

  const parsed = parseFetcher.data?.ok ? parseFetcher.data : null;
  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.preview.map((r) => [r.sku, r.vipPrice.toFixed(2)]);
  }, [parsed]);

  const progressPct = job && job.totalRows > 0
    ? Math.round((job.processedRows / job.totalRows) * 100)
    : 0;

  const failureRows = (job?.failures || []).slice(0, 200).map((f) => [f.sku, f.message]);

  return (
    <Page title="Upload VIP prices" backAction={{ content: "Home", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">1. Choose your CSV</Text>
              <Text as="p" tone="subdued">
                Columns required: <code>SKU</code> and <code>VIP Price</code>.
                Variants not in the CSV will have their <code>vip_price</code> metafield removed.
              </Text>
              <DropZone
                accept=".csv,text/csv"
                allowMultiple={false}
                onDrop={handleDrop}
              >
                {file ? (
                  <div style={{ padding: 16 }}>
                    <Text as="p">{file.name} ({Math.round(file.size / 1024)} KB)</Text>
                  </div>
                ) : (
                  <DropZone.FileUpload actionTitle="Add CSV" />
                )}
              </DropZone>
            </BlockStack>
          </Card>
        </Layout.Section>

        {parsed && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">2. Preview</Text>
                <InlineStack gap="200">
                  <Badge tone="info">{parsed.total} unique SKUs</Badge>
                  {parsed.duplicateCount > 0 && (
                    <Badge tone="attention">{parsed.duplicateCount} duplicates (last row wins)</Badge>
                  )}
                  {parsed.parseErrors.length > 0 && (
                    <Badge tone="warning">{parsed.parseErrors.length} parse errors</Badge>
                  )}
                </InlineStack>

                {parsed.parseErrors.length > 0 && (
                  <Banner tone="warning" title="Some rows were skipped">
                    <BlockStack gap="100">
                      {parsed.parseErrors.slice(0, 5).map((e, i) => (
                        <Text as="p" key={i}>Line {e.line}: {e.message}</Text>
                      ))}
                      {parsed.parseErrors.length > 5 && (
                        <Text as="p" tone="subdued">
                          ... and {parsed.parseErrors.length - 5} more
                        </Text>
                      )}
                    </BlockStack>
                  </Banner>
                )}

                <DataTable
                  columnContentTypes={["text", "numeric"]}
                  headings={["SKU", "VIP Price"]}
                  rows={previewRows}
                />

                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    onClick={handleApply}
                    loading={applyFetcher.state !== "idle"}
                    disabled={parsed.total === 0 || activeJobId !== null}
                  >
                    Apply {parsed.total} prices
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {job && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">3. Progress</Text>
                <InlineStack gap="200">
                  <StatusBadge status={job.status} />
                  <Text as="p">
                    {job.processedRows} of {job.totalRows} processed
                  </Text>
                </InlineStack>
                <ProgressBar progress={progressPct} />
                <InlineStack gap="400">
                  <Text as="p" tone="success">✓ Updated: {job.successCount}</Text>
                  <Text as="p" tone="critical">✗ Failed: {job.failureCount}</Text>
                  <Text as="p" tone="subdued">Deleted (not in CSV): {job.deletedCount}</Text>
                </InlineStack>
                {job.errorMessage && (
                  <Banner tone="critical" title="Job error">
                    <Text as="p">{job.errorMessage}</Text>
                  </Banner>
                )}
                {failureRows.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">Failures</Text>
                    <DataTable
                      columnContentTypes={["text", "text"]}
                      headings={["SKU", "Reason"]}
                      rows={failureRows}
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}

function StatusBadge({ status }) {
  if (status === "done") return <Badge tone="success">Done</Badge>;
  if (status === "running") return <Badge tone="info">Running</Badge>;
  if (status === "error") return <Badge tone="critical">Error</Badge>;
  return <Badge>Pending</Badge>;
}
