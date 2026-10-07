// Prints an XSUAA access token as "Bearer <token>" for the Cline config.
// Run: node --env-file=.env src/get-token.js
const { XSUAA_URL, XSUAA_CLIENT_ID, XSUAA_CLIENT_SECRET } = process.env;

const res = await fetch(`${XSUAA_URL}/oauth/token`, {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${XSUAA_CLIENT_ID}:${XSUAA_CLIENT_SECRET}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded"
  },
  body: "grant_type=client_credentials"
});

if (!res.ok) {
  console.error(`Token request failed: ${res.status}. Check XSUAA_* in .env`);
  process.exit(1);
}

const { access_token, expires_in } = await res.json();
console.log(`Bearer ${access_token}`);
console.error(`(valid for ${Math.round(expires_in / 3600)} hours)`);