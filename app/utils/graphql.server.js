// All GraphQL strings used by the admin app.
// Function input queries live in extensions/vip-discount/src/run.graphql

export const VARIANTS_BY_SKU_QUERY = `#graphql
  query VariantsBySku($query: String!, $cursor: String) {
    productVariants(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        price
        vipPrice: metafield(namespace: "custom", key: "vip_price") {
          id
          value
        }
        product { id }
      }
    }
  }
`;

export const ALL_VARIANTS_WITH_VIP_PRICE_QUERY = `#graphql
  query AllVariantsWithVipPrice($cursor: String) {
    productVariants(first: 100, after: $cursor, query: "metafields.custom.vip_price:*") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        vipPrice: metafield(namespace: "custom", key: "vip_price") {
          id
          value
        }
      }
    }
  }
`;

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace ownerType }
      userErrors { field message code }
    }
  }
`;

export const METAFIELDS_DELETE_MUTATION = `#graphql
  mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id name namespace key }
      userErrors { field message code }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION = `#graphql
  mutation DiscountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors { field message code }
    }
  }
`;

export const SHOP_FUNCTIONS_QUERY = `#graphql
  query ShopFunctions {
    shopifyFunctions(first: 50) {
      nodes {
        id
        app { title }
        apiType
        title
      }
    }
  }
`;
