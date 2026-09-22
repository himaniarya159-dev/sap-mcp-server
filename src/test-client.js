import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({
  name: "sap-mcp-test-client",
  version: "1.0.0"
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/index.js"]
});

await client.connect(transport);

const result = await client.callTool({
  name: "get_customer",
  arguments: {
    customerId: "1001"
  }
});

console.log(JSON.stringify(result, null, 2));

await client.close();