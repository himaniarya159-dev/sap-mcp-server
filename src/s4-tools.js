import { z } from "zod";
import { randomUUID } from "node:crypto";
import httpClient from "@sap-cloud-sdk/http-client";

const { executeHttpRequest } = httpClient;

// ============================================================
// SAP S/4HANA via BTP destination
// The URL and the API key live in the destination, not in this code.
// ============================================================
const DESTINATION = { destinationName: process.env.S4_DESTINATION || "S4HANA_SANDBOX" };
const SO_API = "/sap/opu/odata/sap/API_SALES_ORDER_SRV";
const BP_API = "/sap/opu/odata/sap/API_BUSINESS_PARTNER";
const SOURCE = "SAP S/4HANA (live)";

// Only the fields the agent needs: 10 instead of 94
const ORDER_FIELDS = [
  "SalesOrder", "SoldToParty", "SalesOrderDate", "RequestedDeliveryDate",
  "OverallSDProcessStatus", "OverallDeliveryStatus", "OverallOrdReltdBillgStatus",
  "TotalNetAmount", "TransactionCurrency", "PurchaseOrderByCustomer"
].join(",");

// S/4HANA status codes -> words a business user understands
const PROCESS_STATUS  = { "": "Not relevant", A: "Open", B: "In process", C: "Completed" };
const DELIVERY_STATUS = { "": "Not relevant", A: "Not delivered", B: "Partially delivered", C: "Fully delivered" };
const BILLING_STATUS  = { "": "Not relevant", A: "Not billed", B: "Partially billed", C: "Fully billed" };
const STATUS_CODE     = { "open": "A", "in process": "B", "completed": "C" };

// "/Date(1471392000000)/" -> "2016-08-17"
function sapDate(value) {
  const m = /\/Date\((\d+)/.exec(value || "");
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

// Escape single quotes inside OData string literals
const odataString = s => String(s).replace(/'/g, "''");

// Build the OData query string ourselves: values like "SoldToParty eq 'X'" contain
// spaces and quotes, which must be URL-encoded (the SDK's params option does not do this).
function queryString(params) {
  return Object.entries({ $format: "json", ...params })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

async function s4Get(path, params = {}) {
  const res = await executeHttpRequest(DESTINATION, {
    method: "GET",
    url: `${path}?${queryString(params)}`
  });
  return res.data.d;
}

function toOrder(o) {
  return {
    salesOrder: o.SalesOrder,
    customer: o.SoldToParty,
    orderDate: sapDate(o.SalesOrderDate),
    requestedDelivery: sapDate(o.RequestedDeliveryDate),
    status: PROCESS_STATUS[o.OverallSDProcessStatus] ?? o.OverallSDProcessStatus,
    deliveryStatus: DELIVERY_STATUS[o.OverallDeliveryStatus] ?? o.OverallDeliveryStatus,
    billingStatus: BILLING_STATUS[o.OverallOrdReltdBillgStatus] ?? o.OverallOrdReltdBillgStatus,
    netAmount: `${o.TotalNetAmount} ${o.TransactionCurrency}`,
    customerReference: o.PurchaseOrderByCustomer || null
  };
}

// Input checks: also stop anyone from injecting extra OData syntax
const orderId = z.string().regex(/^\d{1,10}$/, "Digits only")
  .describe("Sales order number, for example 7");
const customerId = z.string().regex(/^[A-Za-z0-9-]{1,10}$/, "Letters, digits and - only")
  .describe("Customer number, for example 17100001 or USCU-CUS01");

// ============================================================
// WRITE: prepared (not yet created) sales orders, waiting for a human "yes"
// Kept in memory: fine for one app instance. Several instances would need Redis or a database.
// ============================================================
const SALES_AREA = { SalesOrderType: "OR", SalesOrganization: "1710", DistributionChannel: "10", OrganizationDivision: "00" };
const PREPARE_TTL_MINUTES = 5;
export const pendingOrders = new Map(); // confirmationId -> { order, clientId, expiresAt }

const material = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Letters, digits, _ and - only")
  .describe("Material number, for example TG13");

// WRITE_MODE=live -> real POST to S/4HANA (needs a real system).
// Anything else -> simulated: the Business Accelerator Hub sandbox does not save new orders.
const LIVE_WRITE = process.env.WRITE_MODE === "live";
const simulatedOrders = new Map(); // simulated order number -> stored order
let simulatedCounter = 0;

class ToolInputError extends Error {}

// Create the order, then READ IT BACK: the answer comes from what the system holds, not from "HTTP 201"
async function createAndVerify(order) {
  let number;
  if (LIVE_WRITE) {
    const res = await executeHttpRequest(DESTINATION, {
      method: "POST",
      url: `${SO_API}/A_SalesOrder`,
      data: {
        SalesOrderType: order.SalesOrderType,
        SalesOrganization: order.SalesOrganization,
        DistributionChannel: order.DistributionChannel,
        OrganizationDivision: order.OrganizationDivision,
        SoldToParty: order.SoldToParty,
        to_Item: { results: [{ Material: order.Material, RequestedQuantity: String(order.RequestedQuantity) }] }
      }
    }); // the SAP Cloud SDK fetches the CSRF token for POST automatically
    number = res.data.d.SalesOrder;
    const check = await s4Get(`${SO_API}/A_SalesOrder('${number}')`, { $select: `${ORDER_FIELDS},to_Item`, $expand: "to_Item" });
    return { ...toOrder(check), verified: true, mode: "live", source: SOURCE };
  }
  simulatedCounter += 1;
  number = `SIM${String(simulatedCounter).padStart(7, "0")}`;
  simulatedOrders.set(number, { ...order, SalesOrder: number, OverallSDProcessStatus: "A", createdAt: new Date().toISOString() });
  const stored = simulatedOrders.get(number); // read back from the store, never from our own variables
  return {
    salesOrder: stored.SalesOrder,
    customer: stored.SoldToParty,
    material: stored.Material,
    quantity: `${stored.RequestedQuantity} PC`,
    status: PROCESS_STATUS[stored.OverallSDProcessStatus],
    verified: true,
    mode: "simulated - the SAP Business Accelerator Hub sandbox does not save new orders",
    source: "MCP server (simulation)"
  };
}

// ============================================================
// TOOL REGISTRY (live SAP S/4HANA) - same tool names as the sample version
// Each tool declares the scope it needs (index.js checks it). No scope = Orders.Read.
// ============================================================
export const s4Tools = [
  {
    name: "get_customer",
    description: "Get an SAP S/4HANA customer by customer number, including up to 10 of the customer's sales orders.",
    inputSchema: { customerId },
    run: async a => {
      const id = odataString(a.customerId);
      const c = await s4Get(`${BP_API}/A_Customer('${id}')`);
      const o = await s4Get(`${SO_API}/A_SalesOrder`, {
        $select: ORDER_FIELDS, $filter: `SoldToParty eq '${id}'`, $top: "10"
      });
      return {
        customerId: c.Customer,
        name: c.CustomerName,
        orders: o.results.map(toOrder),
        source: SOURCE
      };
    }
  },
  {
    name: "find_customers",
    description: "Find SAP S/4HANA customers by part of their name (case-sensitive). " +
                 "Use this when the user gives a customer name instead of a customer number.",
    inputSchema: { name: z.string().min(2).max(40).describe("Part of the customer name") },
    run: async a => {
      const d = await s4Get(`${BP_API}/A_Customer`, {
        $select: "Customer,CustomerName",
        $filter: `substringof('${odataString(a.name)}',CustomerName)`,
        $top: "20"
      });
      return {
        customers: d.results.map(c => ({ customerId: c.Customer, name: c.CustomerName })),
        source: SOURCE
      };
    }
  },
  {
    name: "get_order_updates",
    description: "Get all details of an SAP S/4HANA sales order: customer, overall/delivery/billing status, " +
                 "dates, net amount and items.",
    inputSchema: { orderId },
    run: async a => {
      const o = await s4Get(`${SO_API}/A_SalesOrder('${a.orderId}')`, {
        $select: `${ORDER_FIELDS},to_Item`,
        $expand: "to_Item"
      });
      return {
        ...toOrder(o),
        items: (o.to_Item?.results || []).map(i => ({
          item: i.SalesOrderItem,
          material: i.Material,
          description: i.SalesOrderItemText,
          quantity: `${i.RequestedQuantity} ${i.RequestedQuantityUnit}`,
          netAmount: `${i.NetAmount} ${i.TransactionCurrency}`
        })),
        source: SOURCE
      };
    }
  },
  {
    name: "list_orders",
    description: "List up to 20 SAP S/4HANA sales orders, optionally filtered by customer number " +
                 "and/or status (Open, In process, Completed).",
    inputSchema: {
      customerId: customerId.optional(),
      status: z.string().optional().describe("Open, In process or Completed")
    },
    run: async a => {
      const filters = [];
      if (a.customerId) filters.push(`SoldToParty eq '${odataString(a.customerId)}'`);
      if (a.status) {
        const code = STATUS_CODE[a.status.toLowerCase()];
        if (!code) return { error: `Unknown status "${a.status}". Use Open, In process or Completed.` };
        filters.push(`OverallSDProcessStatus eq '${code}'`);
      }
      const params = { $select: ORDER_FIELDS, $top: "20" };
      if (filters.length) params.$filter = filters.join(" and ");
      const d = await s4Get(`${SO_API}/A_SalesOrder`, params);
      return { count: d.results.length, orders: d.results.map(toOrder), source: SOURCE };
    }
  },
  {
    name: "prepare_sales_order",
    scope: "Orders.Write",
    description: "Prepare a new SAP S/4HANA sales order. This does NOT create anything: it checks the customer " +
                 "and returns a preview plus a confirmationId. Always show the preview to the user and ask " +
                 "for an explicit yes. Only after that yes, call confirm_sales_order with the confirmationId.",
    inputSchema: {
      customerId,
      material,
      quantity: z.number().int().min(1).max(1000).describe("Quantity in pieces, 1 to 1000")
    },
    run: async (a, extra) => {
      const c = await s4Get(`${BP_API}/A_Customer('${odataString(a.customerId)}')`); // 404 -> NOT_FOUND
      const confirmationId = randomUUID();
      const expiresAt = Date.now() + PREPARE_TTL_MINUTES * 60_000;
      const order = { ...SALES_AREA, SoldToParty: c.Customer, Material: a.material, RequestedQuantity: a.quantity };
      pendingOrders.set(confirmationId, { order, clientId: extra?.authInfo?.clientId ?? null, expiresAt });
      return {
        preview: {
          customer: `${c.Customer} (${c.CustomerName})`,
          material: a.material,
          quantity: `${a.quantity} PC`,
          salesArea: "1710 / 10 / 00",
          orderType: "OR (standard order)"
        },
        confirmationId,
        expiresInMinutes: PREPARE_TTL_MINUTES,
        status: "PREPARED - nothing has been created in SAP S/4HANA yet",
        source: SOURCE
      };
    }
  },
  {
    name: "confirm_sales_order",
    scope: "Orders.Write",
    description: "Create a sales order that was prepared with prepare_sales_order. ONLY call this after the user " +
                 "has seen the preview and explicitly said yes in this conversation. Calling it twice with the " +
                 "same confirmationId never creates a second order.",
    inputSchema: {
      confirmationId: z.string().uuid().describe("The confirmationId returned by prepare_sales_order")
    },
    run: async (a, extra) => {
      const p = pendingOrders.get(a.confirmationId);
      const clientId = extra?.authInfo?.clientId ?? null;
      if (!p) {
        return { error: "INVALID_CONFIRMATION", retryable: false,
                 message: "Unknown confirmationId. Prepare the order again with prepare_sales_order." };
      }
      if (p.clientId !== clientId) {
        return { error: "INVALID_CONFIRMATION", retryable: false,
                 message: "This confirmation belongs to a different client." };
      }
      // Idempotent: a repeated confirm returns the first result and creates nothing new
      if (p.result) return { ...p.result, note: "Already created earlier. No second order was created." };
      if (Date.now() > p.expiresAt) {
        pendingOrders.delete(a.confirmationId);
        return { error: "CONFIRMATION_EXPIRED", retryable: false,
                 message: `The preview expired after ${PREPARE_TTL_MINUTES} minutes. Prepare the order again.` };
      }
      p.result = await createAndVerify(p.order);
      return p.result;
    }
  }
];