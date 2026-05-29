import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  DataTable,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const jobs = await prisma.vipPriceJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return json({
    shop: session.shop,
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      totalRows: j.totalRows,
      processedRows: j.processedRows,
      successCount: j.successCount,
      failureCount: j.failureCount,
      deletedCount: j.deletedCount,
      createdAt: j.createdAt.toISOString(),
    })),
  });
};

export default function AppIndex() {
  const { jobs } = useLoaderData();

  const statusBadge = (status) => {
    if (status === "done") return <Badge tone="success">Done</Badge>;
    if (status === "running") return <Badge tone="info">Running</Badge>;
    if (status === "error") return <Badge tone="critical">Error</Badge>;
    return <Badge>Pending</Badge>;
  };

  const rows = jobs.map((j) => [
    new Date(j.createdAt).toLocaleString(),
    statusBadge(j.status),
    String(j.totalRows),
    String(j.successCount),
    String(j.failureCount),
    String(j.deletedCount),
  ]);

  return (
    <Page title="VIP Pricing">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Welcome</Text>
              <Text as="p">
                Upload a CSV of SKUs and VIP prices. Logged-in customers with the{" "}
                <code>vip</code> tag will see (and pay) those prices everywhere.
              </Text>
              <InlineStack gap="200">
                <Link to="/app/upload">
                  <Button variant="primary">Upload VIP prices</Button>
                </Link>
                <Link to="/app/setup">
                  <Button>Setup checkout discount</Button>
                </Link>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Recent imports</Text>
              {jobs.length === 0 ? (
                <Text as="p" tone="subdued">No jobs yet.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["When", "Status", "Rows", "Updated", "Failed", "Deleted"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
