#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
// Drop undefined values so optional inputs are not sent to the actor at all.
function compact(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
// The actor types its switches as strings ("true"/"false") for Clay
// compatibility, because Clay sends every input as a string and a boolean typed
// field silently receives "false" and reads it as truthy. The model gets a real
// boolean and the actor gets the string it validates.
function boolToString(v) {
    return v === undefined ? undefined : v ? "true" : "false";
}
// How long this wrapper waits for a run, in milliseconds. The run itself keeps
// the actor's own default timeout; past this wait the call returns the run id
// and console link instead of an error that hides a run still billing.
const WRAPPER_WAIT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = Number(process.env.MAMBA_POLL_INTERVAL_MS) || 3000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// memory=256 is deliberate and matches the actor's declared
// defaultRunOptions.memoryMbytes, so the run is billed at the size the actor
// was built for rather than the API default.
//
// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it while
// the run goes on and keeps billing. Starting the run, polling it to a terminal
// status and then reading the dataset waits as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(actorPath, actorLabel, input) {
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
        return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
    }
    const headers = {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    };
    const httpError = async (response) => {
        let detail = "";
        try {
            const body = (await response.json());
            if (body?.error?.message)
                detail = ` ${body.error.message}`;
        }
        catch {
            detail = "";
        }
        switch (response.status) {
            case 400:
                return `The ${actorLabel} run was rejected as invalid input.${detail}`;
            case 401:
                return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
            case 402:
                return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
            default:
                return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
        }
    };
    // 1. Start the run.
    let started;
    try {
        started = await fetch(`https://api.apify.com/v2/acts/${actorPath}/runs?memory=256`, { method: "POST", headers, body: JSON.stringify(input) });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
    }
    if (!started.ok) {
        return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
    }
    let run;
    try {
        run = (await started.json()).data ?? {};
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
    }
    const runId = run.id;
    if (!runId) {
        return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
    }
    // 2. Poll to a terminal status.
    const deadline = Date.now() + WRAPPER_WAIT_MS;
    let status = run.status ?? "READY";
    let datasetId = run.defaultDatasetId;
    while (!TERMINAL.has(status)) {
        if (Date.now() >= deadline) {
            return {
                isError: true,
                content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
            };
        }
        await sleep(POLL_INTERVAL_MS);
        let poll;
        try {
            poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
        }
        if (!poll.ok) {
            return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
        }
        const body = (await poll.json());
        status = body.data?.status ?? status;
        datasetId = body.data?.defaultDatasetId ?? datasetId;
    }
    // 3. A run that did not succeed is a failure the caller must see, never an
    // empty success, so a crashed run never reads as "no results found".
    if (status !== "SUCCEEDED") {
        return {
            isError: true,
            content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
        };
    }
    if (!datasetId) {
        return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
    }
    // 4. Read the dataset.
    let ds;
    try {
        ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
    }
    if (!ds.ok) {
        return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
    }
    let items;
    try {
        items = await ds.json();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
    }
    if (!Array.isArray(items)) {
        const asObj = items;
        const detail = asObj?.error?.message
            ? `${asObj.error.message}`
            : JSON.stringify(items);
        return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}
const server = new McpServer({
    name: "mamba-bluesky-brand-presence-mapper",
    version: pkg.version,
});
// Bluesky Brand Presence Mapper (immutable actor ID eLpxzP4IuXznlFVND)
server.registerTool("map_bluesky_brand_presence", {
    title: "Map Bluesky Brand Presence",
    description: "Resolve a company domain, or a Bluesky handle, to that company's official Bluesky account through the public AT Protocol API. Returns the profile URL, handle, DID, exact follower, following and post counts, display name, bio and account creation date, as one flat Clay ready row. Counts are EXACT here, not rounded, unlike every other platform in this family. When the resolved handle IS the company domain, Bluesky granted it after a DNS check the company had to pass, and the row flags that as the strongest identity evidence available. A company with no Bluesky account returns not_found, which is a real and common answer. Read only; requires an APIFY_TOKEN and consumes Apify credits per call.",
    annotations: {
        title: "Map Bluesky Brand Presence",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    inputSchema: {
        company_domain: z.string()
            .optional()
            .describe("Bare company domain, for example shopify.com. Supply this or a handle. With a domain the actor runs full discovery; with a handle it skips straight to the fetch."),
        company_name: z.string()
            .optional()
            .describe("Optional. Improves search accuracy and is what the identity gate checks a discovered profile against, so supplying it reduces wrong matches."),
        handle: z.string()
            .optional()
            .describe("Optional. A Bluesky handle such as shopify.com, mamba.bsky.social, or a did. Supplying it skips discovery entirely and goes straight to the profile fetch. A company that has verified its domain with Bluesky uses the bare domain as its handle, which is why this often equals company_domain."),
        includeFollowerCounts: z.boolean()
            .optional()
            .describe("When \"true\" (default) the profile page is fetched and the counts are extracted. Set \"false\" to resolve the profile URL only, which is cheaper and needs no proxy. Sent as a string for Clay compatibility."),
        skipCache: z.boolean()
            .optional()
            .describe("When \"false\" (default) a successful lookup is cached for seven days and reused. Set \"true\" to force a fresh fetch. Sent as a string for Clay compatibility."),
        useActorSearch: z.boolean()
            .optional()
            .describe("When \"true\" (default) and the domain is not itself a verified handle, Bluesky's own account search is used to find the company. Set \"false\" to rely only on the company homepage and the domain as handle, which avoids any chance of matching a similarly named account. Sent as a string for Clay compatibility."),
    },
}, async ({ company_domain, company_name, handle, includeFollowerCounts, skipCache, useActorSearch }) => {
    return runActor("eLpxzP4IuXznlFVND", "Bluesky Brand Presence Mapper", compact({
        company_domain,
        company_name,
        handle,
        includeFollowerCounts: boolToString(includeFollowerCounts),
        skipCache: boolToString(skipCache),
        useActorSearch: boolToString(useActorSearch),
    }));
});
const transport = new StdioServerTransport();
await server.connect(transport);
