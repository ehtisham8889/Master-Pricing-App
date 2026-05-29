// @ts-check

const NO_OPERATIONS = { operations: [] };

export function cartLinesDiscountsGenerateRun(input) {
  if (!input || !input.cart) return NO_OPERATIONS;

  const customer = input.cart.buyerIdentity && input.cart.buyerIdentity.customer;
  if (!customer || !customer.hasVipTag) return NO_OPERATIONS;

  const classes = (input.discount && input.discount.discountClasses) || [];
  const allowsProduct = classes.length === 0 || classes.indexOf("PRODUCT") !== -1;
  if (!allowsProduct) return NO_OPERATIONS;

  const candidates = [];

  for (const line of input.cart.lines || []) {
    const m = line.merchandise;
    if (!m || m.__typename !== "ProductVariant") continue;

    // Price now comes from the cart line, not the variant
    const lineCost = line.cost && line.cost.amountPerQuantity;
    if (!lineCost || !lineCost.amount) continue;

    if (!m.vipPrice || m.vipPrice.value == null || m.vipPrice.value === "") continue;

    const normal = parseFloat(lineCost.amount);
    const vip = parseFloat(m.vipPrice.value);
    if (!isFinite(normal) || !isFinite(vip)) continue;
    if (vip < 0) continue;
    if (vip >= normal) continue;

    const perUnit = Math.round((normal - vip) * 100) / 100;
    if (perUnit <= 0) continue;

    candidates.push({
      message: "VIP Price",
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          amount: perUnit.toFixed(2),
          appliesToEachItem: true,
        },
      },
    });
  }

  if (candidates.length === 0) return NO_OPERATIONS;

  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: "FIRST",
          candidates,
        },
      },
    ],
  };
}