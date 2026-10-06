# Bluesky Brand Presence Mapper MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-bluesky-brand-presence-mapper)](https://smithery.ai/servers/mambabuilt/mcp-bluesky-brand-presence-mapper) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-bluesky-brand-presence-mapper/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-bluesky-brand-presence-mapper) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-bluesky-brand-presence-mapper%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-bluesky-brand-presence-mapper&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-bluesky-brand-presence-mapper)](https://www.npmjs.com/package/@mambalabsdev/mcp-bluesky-brand-presence-mapper) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-bluesky-brand-presence-mapper)](https://www.npmjs.com/package/@mambalabsdev/mcp-bluesky-brand-presence-mapper) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-bluesky-brand-presence-mapper)](https://github.com/mambalabsdev/mcp-bluesky-brand-presence-mapper/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-bluesky-brand-presence-mapper)

An MCP server that resolves a company domain to its Bluesky account with exact follower, following and post counts. It wraps the Mamba Labs Bluesky Brand Presence Mapper actor on Apify and returns a Clay-ready flat JSON row to any MCP client.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Inputs](#inputs)
- [Output](#output)
- [Example output](#example-output)
- [Features](#features)
- [Full actor documentation](#full-actor-documentation)
- [Mamba Labs GTM Suite](#mamba-labs-gtm-suite)
- [License](#license)

## What it does

Give it a company domain, or a Bluesky handle if you already have one, and it finds that company's official Bluesky account through the public AT Protocol API. It returns the profile URL, handle, DID, exact follower, following and post counts, display name, bio and account creation date, as one flat row.

The counts are exact rather than rounded. When the resolved handle is the company domain itself, Bluesky granted that handle only after a DNS check the company had to pass, and the row flags that as the strongest identity evidence the platform offers. A company with no Bluesky account returns `not_found`, which is a real and common answer rather than a failure.

All of the lookup runs on Apify. This package is a thin client that calls the actor and hands back the result unchanged.

The tool starts the actor run and polls it to a finished status, so a long run is not cut off at 300 seconds. The run is allowed 1,800 seconds. If it is still going two minutes after that, the call stops waiting and returns the run ID with a link to it in the Apify Console, where the results land when it finishes. A run that does not succeed comes back as an error with its run ID and status.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mamba-bluesky-brand-presence-mapper": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-bluesky-brand-presence-mapper"],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Get your token at https://console.apify.com/account/integrations, paste it in, and restart Claude Desktop. The `map_bluesky_brand_presence` tool will be available.

## Prerequisites

- Node.js 18 or newer
- An Apify account with an API token

## Example prompts

- "Find the Bluesky account for theverge.com and give me its follower count."
- "Does shopify.com have a Bluesky account, and is the handle domain verified?"
- "Look up the Bluesky handle theverge.com and tell me when the account was created."
- "Map the Bluesky presence for npr.org without using Bluesky account search."

## Inputs

- `company_domain` (optional): bare company domain, for example `shopify.com`. Supply this or a handle. With a domain the actor runs full discovery; with a handle it skips straight to the fetch.
- `company_name` (optional): improves search accuracy and is what the identity gate checks a discovered profile against, so supplying it reduces wrong matches.
- `handle` (optional): a Bluesky handle such as `shopify.com`, `mamba.bsky.social`, or a DID. Supplying it skips discovery entirely. A company that has verified its domain with Bluesky uses the bare domain as its handle, which is why this often equals `company_domain`.
- `includeFollowerCounts` (optional): when true (the default) the profile is fetched and the counts are extracted. Set false to resolve the profile URL only, which is cheaper.
- `skipCache` (optional): when false (the default) a successful lookup is cached for seven days and reused. Set true to force a fresh fetch.
- `useActorSearch` (optional): when true (the default) and the domain is not itself a verified handle, Bluesky's own account search is used. Set false to rely only on the company homepage and the domain as handle, which avoids any chance of matching a similarly named account.

Supply either `company_domain` or `handle`.

## Output

The tool returns the actor's flat JSON row for the company, with 18 snake_case fields and no nested objects. Read `bluesky_status` before reading any count: `ok`, `not_found`, `not_extractable`, `blocked`, `identity_mismatch`, `auth_failed` or `skipped` are different answers and the wrapper never collapses them. `bluesky_discovery` says which route found the account, from `domain_handle` (strongest) down to `pattern_guess`. See the Apify Store page for the full output schema.

## Example output

```json
{
  "degraded": false,
  "degradation_reason": null,
  "company_domain": "theverge.com",
  "company_name": "The Verge",
  "bluesky_url": "https://bsky.app/profile/theverge.com",
  "bluesky_handle": "theverge.com",
  "bluesky_did": "did:plc:7exlcsle4mjfhu3wnhcgizz6",
  "bluesky_domain_verified": true,
  "bluesky_followers": 357220,
  "bluesky_following": 141,
  "bluesky_posts": 14584,
  "bluesky_followers_exact": true,
  "bluesky_display_name": "The Verge",
  "bluesky_bio": "The Verge covers the intersection of technology, science, art, and culture.",
  "bluesky_created_at": "2023-05-23T19:11:25.009Z",
  "bluesky_discovery": "domain_handle",
  "bluesky_status": "ok",
  "run_date": "2026-08-22T19:26:58.474Z"
}
```

## Features

- Resolves a brand Bluesky account starting from a company domain
- Exact follower, following and post counts, not rounded
- Stable DID returned alongside the handle, so an account can be tracked over time
- Domain verification status, which Bluesky grants only after a DNS check
- Account creation date, so a new presence is distinguishable from an established one
- The discovery route is reported on every row in `bluesky_discovery`
- 18 flat snake_case fields, one row per company

## Full actor documentation

This server is a thin client and holds no lookup logic. For the complete input and output reference, pricing, and run history, see the Apify Store page:

https://apify.com/mambalabs/bluesky-brand-presence-mapper

---

## Mamba Labs GTM Suite

This server is one of the Mamba Labs GTM Suite MCP servers. Every actor in the suite takes a domain or a company and returns one flat row, so they stack in the same Clay table without reshaping anything. The actor behind this server is the Bluesky Brand Presence Mapper, immutable Apify actor ID `eLpxzP4IuXznlFVND`.

> Built by [Mamba Labs](https://github.com/mambalabsdev) | [npm](https://www.npmjs.com/org/mambalabsdev) | [Apify Store](https://apify.com/mambalabs)

## License

MIT

Built by Mamba Labs. https://apify.com/mambalabs
