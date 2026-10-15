import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { s4Tools } from "./s4-tools.js";
import xssec from "@sap/xssec";

const { createSecurityContext, XsuaaService } = xssec;

console.log("INDEX.JS STARTED (customers + sales orders)");

// ============================================================
// SAMPLE DATA: customers and their sales orders
// Used when DATA_SOURCE is not "s4" (for example when running locally).
// The live SAP S/4HANA version of the same tools is in s4-tools.js.
// ============================================================
const customers = {
  "1001": { customerId: "1001", name: "ABC Manufacturing",   country: "Canada",        city: "Calgary" },
  "1002": { customerId: "1002", name: "XYZ Technologies",    country: "United States", city: "Austin" },
  "1003": { customerId: "1003", name: "Global Retail GmbH",  country: "Germany",       city: "Hamburg" },
  "1004": { customerId: "1004", name: "Sunrise Foods Ltd",   country: "India",         city: "Pune" },
  "1005": { customerId: "1005", name: "Northern Energy Inc", country: "Canada",        city: "Edmonton" }
};

const orders = {
  "1101": {
    orderId: "1101", customerId: "1001", orderDate: "2026-09-15",
    status: "Shipped", totalAmount: "12,450.00 CAD",
    items: [
      { item: 10, material: "Industrial Pump P-200", quantity: 5 },
      { item: 20, material: "Pressure Valve V-15",   quantity: 20 }
    ],
    updates: [
      { date: "2026-09-15", event: "Order created",   note: "Sales order received from ABC Manufacturing" },
      { date: "2026-09-16", event: "Order confirmed", note: "Credit check passed and stock reserved" },
      { date: "2026-09-18", event: "Goods issued",    note: "Picked and packed at the Calgary warehouse" },
      { date: "2026-09-19", event: "Shipped",         note: "Handed to carrier, tracking number TRK-884512" }
    ],
    expectedDelivery: "2026-09-24"
  },
  "1102": {
    orderId: "1102", customerId: "1001", orderDate: "2026-09-25",
    status: "In Process", totalAmount: "3,980.00 CAD",
    items: [ { item: 10, material: "Pump Seal Kit S-20", quantity: 40 } ],
    updates: [
      { date: "2026-09-25", event: "Order created",   note: "Repeat order from ABC Manufacturing" },
      { date: "2026-09-26", event: "Order confirmed", note: "Scheduled for picking on 2026-10-06" }
    ],
    expectedDelivery: "2026-10-09"
  },
  "1103": {
    orderId: "1103", customerId: "1002", orderDate: "2026-09-20",
    status: "Delayed", totalAmount: "8,300.00 USD",
    items: [ { item: 10, material: "Control Unit C-9", quantity: 2 } ],
    updates: [
      { date: "2026-09-20", event: "Order created",   note: "Sales order received from XYZ Technologies" },
      { date: "2026-09-21", event: "Order confirmed", note: "Original delivery date 2026-09-30" },
      { date: "2026-09-28", event: "Delayed",         note: "Supplier shortage of Control Unit C-9; new delivery date 2026-10-12" }
    ],
    expectedDelivery: "2026-10-12"
  },
  "1104": {
    orderId: "1104", customerId: "1003", orderDate: "2026-09-05",
    status: "Delivered", totalAmount: "4,120.00 EUR",
    items: [ { item: 10, material: "Sensor Kit S-40", quantity: 10 } ],
    updates: [
      { date: "2026-09-05", event: "Order created",   note: "Sales order received from Global Retail GmbH" },
      { date: "2026-09-06", event: "Order confirmed", note: "Stock available" },
      { date: "2026-09-08", event: "Shipped",         note: "Tracking number TRK-771203" },
      { date: "2026-09-12", event: "Delivered",       note: "Proof of delivery signed in Hamburg" },
      { date: "2026-09-13", event: "Invoiced",        note: "Invoice 9004411 sent, due 2026-10-13" }
    ],
    expectedDelivery: "2026-09-12"
  },
  "1105": {
    orderId: "1105", customerId: "1004", orderDate: "2026-09-22",
    status: "On Hold", totalAmount: "1,250,000.00 INR",
    items: [ { item: 10, material: "Food-Grade Conveyor Belt B-7", quantity: 3 } ],
    updates: [
      { date: "2026-09-22", event: "Order created", note: "Sales order received from Sunrise Foods Ltd" },
      { date: "2026-09-23", event: "On hold",       note: "Credit limit exceeded; waiting for approval from finance" }
    ],
    expectedDelivery: "Not confirmed (order on hold)"
  },
  "1106": {
    orderId: "1106", customerId: "1005", orderDate: "2026-09-29",
    status: "Open", totalAmount: "22,700.00 CAD",
    items: [
      { item: 10, material: "Industrial Pump P-200", quantity: 8 },
      { item: 20, material: "Flow Meter F-3",        quantity: 8 }
    ],
    updates: [
      { date: "2026-09-29", event: "Order created", note: "Sales order received from Northern Energy Inc; awaiting confirmation" }
    ],
    expectedDelivery: "2026-10-20"
  }
};

// ============================================================
// BUSINESS LOGIC (sample data)
// ============================================================
function orderSummary(o) {
  return { orderId: o.orderId, orderDate: o.orderDate, status: o.status,
           totalAmount: o.totalAmount, expectedDelivery: o.expectedDelivery };
}

function getCustomer(customerId) {
  const customer = customers[customerId];
  if (!customer) return null;
  const customerOrders = Object.values(orders).filter(o => o.customerId === customerId).map(orderSummary);
  return { ...customer, orders: customerOrders };
}

function findCustomers(name, country) {
  let result = Object.values(customers);
  if (name)    result = result.filter(c => c.name.toLowerCase().includes(name.toLowerCase()));
  if (country) result = result.filter(c => c.country.toLowerCase() === country.toLowerCase());
  return result;
}

function getOrderUpdates(orderId) {
  const order = orders[orderId];
  if (!order) return null;
  const { orders: _ignored, ...customer } = getCustomer(order.customerId);
  return { ...order, customer };
}

function listOrders(customerId, status) {
  let result = Object.values(orders);
  if (customerId) result = result.filter(o => o.customerId === customerId);
  if (status)     result = result.filter(o => o.status.toLowerCase() === status.toLowerCase());
  return result.map(o => ({ ...orderSummary(o), customerId: o.customerId, customerName: customers[o.customerId].name }));
}

// ============================================================
// TOOL REGISTRY (sample data): each tool defined once, registered on the MCP server below
// ============================================================
const sampleTools = [
  {
    name: "get_customer",
    description: "Get a customer by customer ID, including a summary of all of the customer's sales orders.",
    inputSchema: { customerId: z.string().describe("Customer ID, for example 1001") },
    run: a => getCustomer(a.customerId) || { error: `Customer ${a.customerId} was not found.` }
  },
  {
    name: "find_customers",
    description: "Find customers by (part of) their name and/or by country. Use this when the user gives a " +
                 "customer name instead of a customer ID.",
    inputSchema: {
      name: z.string().optional().describe("Part of the customer name, for example ABC"),
      country: z.string().optional().describe("Country, for example Canada")
    },
    run: a => findCustomers(a.name, a.country)
  },
  {
    name: "get_order_updates",
    description: "Get all updates of a sales order: customer, current status, items, total amount, " +
                 "dated status history and expected delivery.",
    inputSchema: { orderId: z.string().describe("Sales order number, for example 1101") },
    run: a => getOrderUpdates(a.orderId) || { error: `Order ${a.orderId} was not found.` }
  },
  {
    name: "list_orders",
    description: "List sales orders, optionally filtered by customer ID and/or status " +
                 "(Open, In Process, Shipped, Delivered, Delayed, On Hold).",
    inputSchema: {
      customerId: z.string().optional().describe("Optional customer ID, for example 1001"),
      status: z.string().optional().describe("Optional status, for example Delayed")
    },
    run: a => listOrders(a.customerId, a.status)
  }
];

// ============================================================
// DATA SOURCE: DATA_SOURCE=s4 -> live SAP S/4HANA via BTP destination,
// otherwise the sample data above. Tool names stay the same either way.
// ============================================================
const useS4 = process.env.DATA_SOURCE === "s4";
const tools = useS4 ? s4Tools : sampleTools;
console.log(`Data source: ${useS4 ? "SAP S/4HANA (BTP destination)" : "sample data"}`);

// ============================================================
// MCP SERVER
// ============================================================
function toolErrorBody(e) {
  const status = e?.response?.status ?? e?.cause?.response?.status;
  if (status === 404) {
    return { error: "NOT_FOUND", retryable: false, message: "This record does not exist in SAP S/4HANA." };
  }
  if (!status && /destination/i.test(e?.message || "")) {
    return { error: "CONFIGURATION_ERROR", retryable: false,
             message: "The SAP S/4HANA connection is not configured (BTP destination not found)." };
  }
  // Only real transient problems are worth a retry: throttling, server errors, network glitches
  const code = e?.code ?? e?.cause?.code;
  const networkGlitch = ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "ECONNREFUSED"].includes(code);
  if (status === 429 || status >= 500 || networkGlitch) {
    return { error: "TEMPORARY_ERROR", retryable: true,
             message: `SAP S/4HANA is temporarily unavailable${status ? ` (HTTP ${status})` : ""}. Try again shortly.` };
  }
  // Everything else (400, 401, 403, bugs in our own request) will fail again the same way
  return { error: "REQUEST_ERROR", retryable: false,
           message: `The SAP S/4HANA request could not be processed${status ? ` (HTTP ${status})` : ""}.` };
}

// ============================================================
// AUTHORIZATION: which tool may this caller run?
// API Management sees WHO is calling. Only the MCP server sees WHICH tool,
// so the scope check per tool lives here. Every tool declares its scope;
// a tool without one counts as a read tool.
// ============================================================
function hasScope(authInfo, scope) {
  if (!authService) return true; // local development without XSUAA: no scopes to check
  const scopes = authInfo?.scopes || [];
  return scopes.some(s => s.endsWith("." + scope)); // XSUAA scopes look like "<xsappname>.Orders.Read"
}

function createMcpServer() {
  const server = new McpServer({ name: "sap-mcp-demo", version: "1.4.0" });

  for (const tool of tools) {
    const scope = tool.scope || "Orders.Read";
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args, extra) => {
        if (!hasScope(extra?.authInfo, scope)) {
          console.warn(`Tool ${tool.name} refused: client ${extra?.authInfo?.clientId} lacks scope ${scope}`);
          const body = { error: "NOT_AUTHORIZED", retryable: false,
                         message: `This client is not allowed to run ${tool.name}. Required scope: ${scope}.` };
          return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
        }
        try {
          const result = await tool.run(args, extra);
          return {
            isError: Boolean(result && result.error),
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (e) {
          const body = toolErrorBody(e);
          console.error(`Tool ${tool.name} failed: ${body.error} - ${e.message}`);
          return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
        }
      }
    );
  }
  return server;
}

// ============================================================
// AUTHENTICATION: the MCP server checks the XSUAA token itself
// (SAP API Management checks it too, but the Cloud Foundry URL
//  must not be a back door around the gateway)
// ============================================================
function xsuaaCredentials() {
  try {
    const services = JSON.parse(process.env.VCAP_SERVICES || "{}");
    return services.xsuaa?.[0]?.credentials || null;
  } catch {
    return null;
  }
}

const xsuaaCreds = xsuaaCredentials();
const authService = xsuaaCreds ? new XsuaaService(xsuaaCreds) : null;
const authRequired = process.env.NODE_ENV === "production";
console.log(`Token check: ${authService ? "ON (XSUAA)" : authRequired ? "MISSING XSUAA BINDING - all /mcp calls are refused" : "off (local development)"}`);

async function authenticate(req) {
  if (!authService) {
    // Locally (npm start) there is no XSUAA binding: allow, so development stays easy.
    // On Cloud Foundry (NODE_ENV=production) a missing binding must never mean "open".
    return authRequired
      ? { ok: false, status: 503, error: "Server is not configured for authentication" }
      : { ok: true, info: null };
  }
  try {
    const ctx = await createSecurityContext(authService, { req });
    const t = ctx.token;
    return { ok: true, info: { token: t.jwt, clientId: t.clientId, scopes: t.scopes || [], extra: {} } };
  } catch (e) {
    console.warn(`Rejected /mcp call: ${e.message}`);
    return { ok: false, status: 401, error: "Unauthorized: a valid XSUAA token is required" };
  }
}

// ============================================================
// HTTP SERVER
// ============================================================
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const port = process.env.PORT || 3000;

const httpServer = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "UP", service: "sap-mcp-demo", dataSource: useS4 ? "s4" : "sample" });
  }

  if (pathname === "/mcp") {
    const auth = await authenticate(req);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    if (auth.info) req.auth = auth.info; // the MCP SDK passes this to every tool as extra.authInfo
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal Server Error" });
    }
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
});

httpServer.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the old server (Ctrl + C) or run:`);
    console.error(`  netstat -ano | findstr :${port}   then   Stop-Process -Id <PID> -Force`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`SAP MCP Server listening on port ${port}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`MCP:    http://localhost:${port}/mcp`);
  console.log(`Tools:  ${tools.map(t => t.name).join(", ")}`);
});