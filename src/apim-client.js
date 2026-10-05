import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
 
// --- Get XSUAA token ---
async function getToken() {
  const basic = Buffer.from(
    `${process.env.XSUAA_CLIENT_ID}:${process.env.XSUAA_CLIENT_SECRET}`
  ).toString("base64");
 
  const res = await fetch(`${process.env.XSUAA_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return (await res.json()).access_token;
}
 
const token = await getToken();
 
// --- Connect to MCP server through SAP API Management ---
const transport = new StreamableHTTPClientTransport(new URL(process.env.APIM_URL), {
  requestInit: {
    headers: {
      "X-API-Key": process.env.APIM_API_KEY,
      Authorization: `Bearer ${token}`
    }
  }
});
 
const client = new Client({ name: "apim-mcp-client", version: "1.0.0" });
await client.connect(transport);
console.log("Connected to MCP server via SAP API Management");
 
// --- Discover tools ---
const { tools } = await client.listTools();
console.log("Discovered tools:", tools.map(t => t.name));
 
// --- Find customers in Canada ---
const canada = await client.callTool({ name: "find_customers", arguments: { country: "Canada" } });
console.log("Customers in Canada:", canada.content[0].text);
 
// --- Get all updates of one sales order (order number from command line, default 1101) ---
const orderId = process.argv[2] || "1101";
const order = await client.callTool({ name: "get_order_updates", arguments: { orderId } });
console.log(`Order ${orderId}:`, order.content[0].text);
 
await client.close();