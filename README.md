# SAP MCP Server on SAP BTP Cloud Foundry

A practical, end-to-end example of building a **Model Context Protocol (MCP) server** in Node.js, deploying it to **SAP BTP Cloud Foundry**, securing it with **SAP API Management** (Integration Suite), and asking it questions in **plain language** through the AI agent **Cline**.

```
You (plain language)
   ▼
Cline (AI agent in VS Code)  or  MCP client
   │  X-API-Key + Authorization: Bearer <XSUAA JWT>
   ▼
SAP API Management ── VerifyAPIKey → VerifyJWT → Quota
   ▼
Node.js MCP Server (BTP Cloud Foundry, Streamable HTTP)
   ▼
Tools: get_customer, find_customers, get_order_updates, list_orders
```

📖 Blog post: _<add your SAP Community blog link here>_

---

## Repository structure

```
sap-mcp-server/
├── .clinerules/
│   └── sap-assistant.md            # Rules for Cline: use only MCP tools, answer in plain language
├── src/
│   ├── index.js                    # MCP server (customers + sales orders)
│   ├── test-client.js              # Local test client
│   └── apim-client.js              # MCP client calling the server through SAP API Management
├── cline-mcp-settings.example.json # Example Cline MCP settings (no real keys)
├── manifest.yml                    # Cloud Foundry deployment descriptor
├── .gitignore
├── .cfignore
└── package.json
```

## Stages and versions

The blog builds the project in stages. The **`main` branch contains the final version**. The first stage (local stdio server) is kept as a **Git tag**, so you can get that exact code as well.

| Stage | What you build | Where to get the code | Run |
|---|---|---|---|
| 1 | Local MCP server over **stdio** | Tag **`v1-local-stdio`** | `node src/test-client.js` |
| 2 | **HTTP** MCP server, tested locally | `main` | `npm start` + `node src/test-client.js` |
| 3 | Deploy to SAP BTP Cloud Foundry | `main` | `cf push` |
| 4 | Secure with SAP API Management + MCP client | `main` | `node --env-file=.env src/apim-client.js` |
| 5 | Ask in plain language with **Cline** | `main` | Cline chat in VS Code |

---

## Prerequisites

- SAP BTP Trial account with the Cloud Foundry environment enabled
- Node.js 20.6+ (developed with v24)
- Cloud Foundry CLI
- SAP Integration Suite with **API Management** activated (Stage 4)
- VS Code with the **Cline** extension (Stage 5)

```bash
git clone https://github.com/himaniarya159-dev/sap-mcp-server.git
cd sap-mcp-server
```

---

## Scenario: customers and their sales orders

| Customer | Orders |
|---|---|
| 1001 ABC Manufacturing (Calgary, Canada) | 1101 Shipped · 1102 In Process |
| 1002 XYZ Technologies (Austin, US) | 1103 Delayed (supplier shortage) |
| 1003 Global Retail GmbH (Hamburg, Germany) | 1104 Delivered and invoiced |
| 1004 Sunrise Foods Ltd (Pune, India) | 1105 On Hold (credit limit) |
| 1005 Northern Energy Inc (Edmonton, Canada) | 1106 Open |

| Tool | What it returns |
|---|---|
| `get_customer` | Customer details plus a summary of all their orders |
| `find_customers` | Customers by (part of) name and/or country |
| `get_order_updates` | Customer, status, items, total, dated update history, expected delivery |
| `list_orders` | Orders filtered by customer and/or status |

The data is sample data. Each tool is defined once in a small registry in `src/index.js`, so adding a tool means adding one block.

---

## Stage 1: Local MCP server (stdio)

Switch to the Stage 1 version:

```bash
git checkout v1-local-stdio
npm install
node src/test-client.js
```

The test client starts `src/index.js` as a local process and calls `get_customer` with ID `1001`:

```json
{ "customerId": "1001", "name": "ABC Manufacturing", "country": "Canada" }
```

When you're done, go back to the latest version:

```bash
git checkout main
npm install
```

## Stage 2: HTTP MCP server (local)

In the `main` version, `src/index.js` is an HTTP server using the Streamable HTTP transport.

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
node src/test-client.js
```

- Health: `http://localhost:3000/health`
- MCP endpoint: `http://localhost:3000/mcp`

## Stage 3: Deploy to SAP BTP Cloud Foundry

1. Edit `manifest.yml` and change the route hostname to something unique.
2. Deploy:

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com
cf target -o <your-org> -s <your-space>
cf push
```

> **Trial note:** Cloud Foundry apps on a trial account are stopped every night. Run `cf start sap-mcp-server` if you get `404 Requested route does not exist`.

## Stage 4: Secure with SAP API Management

1. **API proxy:** Integration Suite → Configure → APIs → Create, with the Cloud Foundry `/mcp` URL as the target.
2. **Policies** in ProxyEndpoint → PreFlow, in this order:
   - **VerifyAPIKey:** `<APIKey ref="request.header.X-API-Key"/>`
   - **VerifyJWT:** RS256, `PublicKey/Value` = the `verificationkey` from your XSUAA service key, `Issuer` = `<xsuaa-url>/oauth/token`
   - **Quota:** for example 10 calls per minute per application (`Identifier ref="client_id"`)
3. **Product and application:** Engage → Products (publish), then subscribe in the Developer Hub to get the API key.
4. **XSUAA:** create an XSUAA instance and service key for the client credentials token.

Create a file named `.env` in the project root. It's excluded from Git and Cloud Foundry. Use single quotes around the values:

```
APIM_URL='https://<your-apim-host>/<your-org>/sap-mcp'
APIM_API_KEY='<api key from Developer Hub application>'
XSUAA_URL='https://<subdomain>.authentication.<region>.hana.ondemand.com'
XSUAA_CLIENT_ID='<clientid from XSUAA service key>'
XSUAA_CLIENT_SECRET='<clientsecret from XSUAA service key>'
```

Run:

```bash
node --env-file=.env src/apim-client.js 1101
```

Expected output:

```
Connected to MCP server via SAP API Management
Discovered tools: [ 'get_customer', 'find_customers', 'get_order_updates', 'list_orders' ]
Customers in Canada: [ ABC Manufacturing, Northern Energy Inc ]
Order 1101: { "orderId": "1101", "status": "Shipped", ... }
```

### Expected security behaviour

| Request | Result |
|---|---|
| API key + JWT | `200` |
| JWT only | `401` `steps.oauth.v2.FailedToResolveAPIKey` |
| API key only | `401` `steps.jwt.FailedToResolveVariable` |
| Over the quota | `500` `policies.ratelimit.QuotaViolation` |

New tools added to the server need **no change in API Management**: the proxy forwards all MCP traffic to `/mcp`, so every tool is protected by the same three policies.

---

## Stage 5: Ask in plain language with Cline

[Cline](https://cline.bot) is an open-source AI agent for VS Code. It connects to this MCP server, discovers the tools through `tools/list`, chooses the right tool for a question and answers in plain language. The server needs no LLM key: the model is configured in Cline.

```
You (plain language) → Cline (LLM) → tools/call → MCP server → Cline (plain language)
```

### Setup

1. Start the server: `node src/index.js` (the log lists the 4 tools).
2. VS Code → install the **Cline** extension → sign in → choose a model (gear icon → API Provider).
3. Cline → **MCP Servers** (plug icon) → **Installed** → **Edit Configuration** and add the `sap-mcp-local` entry from [`cline-mcp-settings.example.json`](cline-mcp-settings.example.json):

   ```json
   {
     "mcpServers": {
       "sap-mcp-local": {
         "type": "streamableHttp",
         "url": "http://localhost:3000/mcp",
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

4. The server shows a green status and **4 tools**.

The file [`.clinerules/sap-assistant.md`](.clinerules/sap-assistant.md) is loaded by Cline automatically when this folder is open in VS Code. It tells Cline to use only the MCP tools (not the project files), never invent data, and answer in a fixed, human-readable pattern.

### Try it

| Question | Tool(s) Cline calls |
|---|---|
| Please give me all updates of order no 1101 | `get_order_updates` |
| Which orders does ABC Manufacturing have? | `find_customers` → `list_orders` |
| Why is order 1103 delayed and when will it arrive? | `get_order_updates` |
| Which orders are on hold or delayed? | `list_orders` |
| Show me the details of order 9999 | `get_order_updates` → "not found" (no invented answer) |

Before every tool call, Cline shows the tool name and arguments and asks for approval, so you can see exactly which tool the agent chose.

### Through SAP API Management

After `cf push`, enable the `sap-mcp-apim` entry in your Cline settings with your proxy URL, `X-API-Key` and a fresh XSUAA token. Every tool call then passes VerifyAPIKey → VerifyJWT → Quota. The token expires, so paste a fresh one before a demo. Never commit the real key or token.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `404 Requested route … does not exist` | Trial app is stopped: `cf start sap-mcp-server` |
| Deployment error `Invalid Public Key Value … policy(VerifyJWT)` | Remove unused policies from **Created Policies**, not only from the flow |
| Token request fails in PowerShell | Put the client secret in **single quotes**, because XSUAA secrets can contain `$` |
| `.env: not found` | Create `.env` in the project root (not in `src`), saved as ASCII/UTF-8 |
| Quota allows a few extra calls | Distributed quota counters sync asynchronously, which is expected |
| `listen EADDRINUSE :3000` | An old server is still running: `netstat -ano \| findstr :3000`, then `Stop-Process -Id <PID> -Force` |
| Cline shows the server in red | Start `node src/index.js`, then click restart on the server in Cline's MCP view |
| Cline shows old tools | Restart the server and click restart (⟳) on the server in Cline |
| Cline answers from the code instead of calling tools | Make sure `.clinerules/sap-assistant.md` is in the project root and the project folder is open |

---

## Security notes

- Never commit `.env`, service keys, API keys, or tokens.
- `cline-mcp-settings.example.json` contains placeholders only. Your real Cline settings live in Cline's own settings file.
- This demo uses sample data. Before connecting real SAP systems, also restrict direct access to the Cloud Foundry URL so that all traffic goes through API Management.

## Next steps

- Replace the sample data with the SAP S/4HANA Business Partner and Sales Order APIs through the BTP Destination service
- Connect the same MCP server to a **Joule agent** (Joule Studio → MCP Servers) through a BTP destination
- OAuth for interactive AI clients
