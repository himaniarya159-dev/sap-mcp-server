import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";

// ===== Customer data (add new customers here) =====
const customers = {
  "1001": { customerId: "1001", name: "ABC Manufacturing",   country: "Canada" },
  "1002": { customerId: "1002", name: "XYZ Technologies",    country: "United States" },
  "1003": { customerId: "1003", name: "Global Retail GmbH",  country: "Germany" },
  "1004": { customerId: "1004", name: "Sunrise Foods Ltd",   country: "India" },
  "1005": { customerId: "1005", name: "Northern Energy Inc", country: "Canada" }
};

function createMcpServer() {
  const server = new McpServer({
    name: "sap-mcp-demo",
    version: "1.0.0"
  });

  // Tool 1: get one customer by ID
  server.registerTool(
    "get_customer",
    {
      description: "Get customer information by customer ID",
      inputSchema: {
        customerId: z.string().describe("Customer ID, e.g. 1001")
      }
    },
    async ({ customerId }) => {
      const customer = customers[customerId];

      if (!customer) {
        return {
          isError: true,
          content: [{ type: "text", text: `Customer ${customerId} was not found.` }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }]
      };
    }
  );

  // Tool 2: list all customers (optionally filtered by country)
  server.registerTool(
    "list_customers",
    {
      description: "List all customers, optionally filtered by country",
      inputSchema: {
        country: z.string().optional().describe("Optional country filter, e.g. Canada")
      }
    },
    async ({ country }) => {
      let result = Object.values(customers);

      if (country) {
        result = result.filter(c => c.country.toLowerCase() === country.toLowerCase());
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  return server;
}

const port = process.env.PORT || 3000;

const httpServer = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "UP", service: "sap-mcp-demo" }));
    return;
  }

  if (req.url === "/mcp") {
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      // Clean up after each request (stateless mode)
      res.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`SAP MCP Server listening on port ${port}`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
});