import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"));
const client = new Client({ name: "sap-mcp-test-client", version: "1.0.0" });

await client.connect(transport);

const { tools } = await client.listTools();
console.log("Discovered tools:", tools.map(t => t.name));

const result = await client.callTool({
  name: "get_customer",
  arguments: { customerId: "1001" }
});
console.log(JSON.stringify(result, null, 2));

await client.close();