# SAP MCP Server on SAP BTP Cloud Foundry

A practical, end-to-end example of building a **Model Context Protocol (MCP) server** in Node.js, deploying it to **SAP BTP Cloud Foundry**, and securing it with **SAP API Management** (Integration Suite).

```
MCP Client / AI Agent
   │  X-API-Key + Authorization: Bearer <XSUAA JWT>
   ▼
SAP API Management ── VerifyAPIKey → VerifyJWT → Quota
   ▼
Node.js MCP Server (BTP Cloud Foundry, Streamable HTTP)
   ▼
Tools: get_customer, list_customers
```

📖 Blog post: _<add your SAP Community blog link here>_

---

## Repository structure

```
sap-mcp-server/
├── src/
│   ├── index.js          # MCP server
│   ├── test-client.js    # Local test client
│   └── apim-client.js    # MCP client calling the server through SAP API Management
├── manifest.yml          # Cloud Foundry deployment descriptor
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

---

## Prerequisites

- SAP BTP Trial account with the Cloud Foundry environment enabled
- Node.js 20.6+ (developed with v24)
- Cloud Foundry CLI
- SAP Integration Suite with **API Management** activated (Stage 4)

```bash
git clone https://github.com/himaniarya159-dev/sap-mcp-server.git
cd sap-mcp-server
```

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
node --env-file=.env src/apim-client.js 1003
```

Expected output:

```
Connected to MCP server via SAP API Management
Discovered tools: [ 'get_customer', 'list_customers' ]
Customer 1003: { "customerId": "1003", "name": "Global Retail GmbH", "country": "Germany" }
```

### Expected security behaviour

| Request | Result |
|---|---|
| API key + JWT | `200` |
| JWT only | `401` `steps.oauth.v2.FailedToResolveAPIKey` |
| API key only | `401` `steps.jwt.FailedToResolveVariable` |
| Over the quota | `500` `policies.ratelimit.QuotaViolation` |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `404 Requested route … does not exist` | Trial app is stopped: `cf start sap-mcp-server` |
| Deployment error `Invalid Public Key Value … policy(VerifyJWT)` | Remove unused policies from **Created Policies**, not only from the flow |
| Token request fails in PowerShell | Put the client secret in **single quotes**, because XSUAA secrets can contain `$` |
| `.env: not found` | Create `.env` in the project root (not in `src`), saved as ASCII/UTF-8 |
| Quota allows a few extra calls | Distributed quota counters sync asynchronously, which is expected |

---

## Security notes

- Never commit `.env`, service keys, API keys, or tokens.
- This demo uses sample data. Before connecting real SAP systems, also restrict direct access to the Cloud Foundry URL so that all traffic goes through API Management.

## Next steps

- Replace the sample data with the S/4HANA Business Partner API through the BTP Destination service
- OAuth for interactive AI clients
