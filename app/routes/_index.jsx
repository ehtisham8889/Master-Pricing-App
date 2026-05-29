import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../shopify.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();
  return (
    <div style={{ maxWidth: 640, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>VIP Pricing</h1>
      <p>A custom Shopify app that powers wholesale/VIP pricing for tagged customers.</p>
      {showForm && (
        <Form method="post" action="/auth/login">
          <label style={{ display: "block", margin: "1rem 0" }}>
            Shop domain
            <input type="text" name="shop" placeholder="example.myshopify.com" style={{ display: "block", padding: 8, marginTop: 4 }} />
          </label>
          <button type="submit">Log in</button>
        </Form>
      )}
    </div>
  );
}
