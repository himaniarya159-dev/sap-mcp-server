import { z } from "zod";
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
// TOOL REGISTRY (live SAP S/4HANA) - same tool names as the sample version
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
  }
];
 