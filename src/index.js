import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "sap-mcp-demo",
  version: "1.0.0"
});

server.registerTool(
  "get_customer",
  {
    description: "Get customer information by customer ID",
    inputSchema: {
      customerId: z.string().describe("Customer ID")
    }
  },
  async ({ customerId }) => {
    const customers = {
      "1001": {
        customerId: "1001",
        name: "ABC Manufacturing",
        country: "Canada"
      },
      "1002": {
        customerId: "1002",
        name: "XYZ Technologies",
        country: "United States"
      }
    };

    const customer = customers[customerId];

    if (!customer) {
      return {
        content: [
          {
            type: "text",
            text: `Customer ${customerId} was not found.`
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(customer, null, 2)
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);