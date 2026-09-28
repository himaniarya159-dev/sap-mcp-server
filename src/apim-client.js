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

// --- List all customers ---
const all = await client.callTool({ name: "list_customers", arguments: {} });
console.log("All customers:", all.content[0].text);

// --- List customers in Canada ---
const canada = await client.callTool({ name: "list_customers", arguments: { country: "Canada" } });
console.log("Canada:", canada.content[0].text);

// --- Get one customer (ID from command line, default 1003) ---
const customerId = process.argv[2] || "1003";
const one = await client.callTool({ name: "get_customer", arguments: { customerId } });
console.log(`Customer ${customerId}:`, one.content[0].text);

await client.close();