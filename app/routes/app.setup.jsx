import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  List,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server.js";
import {
  METAFIELD_DEFINITION_CREATE_MUTATION,
  DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION,
  SHOP_FUNCTIONS_QUERY,
} from "../utils/graphql.server.js";

export const loader = async () => {
  return json({
    functionId: process.env.VIP_DISCOUNT_FUNCTION_ID || null,
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "createMetafield") {
    const resp = await admin.graphql(METAFIELD_DEFINITION_CREATE_MUTATION, {
      variables: {
        definition: {
          name: "VIP Price",
          namespace: "custom",
          key: "vip_price",
          description: "Wholesale/VIP price for variants. Visible to customers tagged 'vip'.",
          type: "number_decimal",
          ownerType: "PRODUCTVARIANT",
          pin: true,
        },
      },
    });
    const data = await resp.json();
    const errs = data?.data?.metafieldDefinitionCreate?.userErrors || [];
    // TAKEN error means it already exists — treat as success
    const benign = errs.filter((e) => e.code !== "TAKEN");
    if (benign.length) {
      return json({ ok: false, intent, errors: benign });
    }
    return json({ ok: true, intent });
  }

  if (intent === "discoverFunction") {
    const resp = await admin.graphql(SHOP_FUNCTIONS_QUERY);
    const data = await resp.json();
    const fns = data?.data?.shopifyFunctions?.nodes || [];
    const match = fns.find((f) =>
      (f.title && f.title.toLowerCase().includes("vip")) ||
      (f.apiType && f.apiType.toLowerCase().includes("discount"))
    );
    return json({
      ok: true,
      intent,
      functions: fns,
      suggestedId: match?.id || null,
    });
  }

  if (intent === "createDiscount") {
    const functionId =
      String(form.get("functionId") || "") || process.env.VIP_DISCOUNT_FUNCTION_ID;
    if (!functionId) {
      return json({
        ok: false,
        intent,
        errors: [{ message: "VIP_DISCOUNT_FUNCTION_ID is not set in .env" }],
      });
    }
    const resp = await admin.graphql(DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION, {
      variables: {
        automaticAppDiscount: {
          title: "VIP Pricing",
          functionId,
          startsAt: new Date().toISOString(),
          discountClasses: ["PRODUCT"],
        },
      },
    });
    const data = await resp.json();
    const errs = data?.data?.discountAutomaticAppCreate?.userErrors || [];
    if (errs.length) {
      return json({ ok: false, intent, errors: errs });
    }
    return json({
      ok: true,
      intent,
      discount: data?.data?.discountAutomaticAppCreate?.automaticAppDiscount,
    });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function SetupPage() {
  const metafieldFetcher = useFetcher();
  const discoverFetcher = useFetcher();
  const discountFetcher = useFetcher();

  const runMetafield = () => {
    const fd = new FormData();
    fd.set("intent", "createMetafield");
    metafieldFetcher.submit(fd, { method: "post" });
  };
  const runDiscover = () => {
    const fd = new FormData();
    fd.set("intent", "discoverFunction");
    discoverFetcher.submit(fd, { method: "post" });
  };
  const runDiscount = () => {
    const fd = new FormData();
    fd.set("intent", "createDiscount");
    if (discoverFetcher.data?.suggestedId) {
      fd.set("functionId", discoverFetcher.data.suggestedId);
    }
    discountFetcher.submit(fd, { method: "post" });
  };

  return (
    <Page title="Setup" backAction={{ content: "Home", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Step 1 — Create the metafield definition</Text>
              <Text as="p">
                Defines <code>custom.vip_price</code> on product variants with
                storefront access set to <strong>PUBLIC_READ</strong> so the theme and
                the discount function can read it.
              </Text>
              <InlineStack>
                <Button
                  variant="primary"
                  onClick={runMetafield}
                  loading={metafieldFetcher.state !== "idle"}
                >
                  Create metafield definition
                </Button>
              </InlineStack>
              {metafieldFetcher.data?.ok && (
                <Banner tone="success" title="Metafield is ready" />
              )}
              {metafieldFetcher.data?.errors?.length > 0 && (
                <Banner tone="critical" title="Could not create metafield">
                  <List>
                    {metafieldFetcher.data.errors.map((e, i) => (
                      <List.Item key={i}>
                        {e.field ? <strong>[{e.field}]</strong> : null} {e.message}
                      </List.Item>
                    ))}
                  </List>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Step 2 — Find the discount function</Text>
              <Text as="p">
                After running <code>npm run deploy</code>, your VIP discount function
                appears in the shop. Click below to discover its ID, then create the
                automatic discount that activates it at checkout.
              </Text>
              <InlineStack>
                <Button onClick={runDiscover} loading={discoverFetcher.state !== "idle"}>
                  Find function
                </Button>
              </InlineStack>
              {discoverFetcher.data?.functions && (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">Functions installed on this shop:</Text>
                  <List>
                    {discoverFetcher.data.functions.map((f) => (
                      <List.Item key={f.id}>
                        <code>{f.title || "(untitled)"}</code> — {f.apiType} — <code>{f.id}</code>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Step 3 — Create the automatic discount</Text>
              <Text as="p">
                Creates a Shopify Automatic Discount that runs the VIP function on every
                checkout. No code required at the customer side — VIP customers
                automatically see the right price.
              </Text>
              <InlineStack>
                <Button
                  variant="primary"
                  onClick={runDiscount}
                  loading={discountFetcher.state !== "idle"}
                >
                  Create automatic discount
                </Button>
              </InlineStack>
              {discountFetcher.data?.ok && discountFetcher.data?.discount && (
                <Banner tone="success" title="Automatic discount created">
                  <Text as="p">
                    Title: <strong>{discountFetcher.data.discount.title}</strong> —
                    Status: <strong>{discountFetcher.data.discount.status}</strong>
                  </Text>
                </Banner>
              )}
              {discountFetcher.data?.errors?.length > 0 && (
                <Banner tone="critical" title="Could not create discount">
                  <List>
                    {discountFetcher.data.errors.map((e, i) => (
                      <List.Item key={i}>{e.message}</List.Item>
                    ))}
                  </List>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
