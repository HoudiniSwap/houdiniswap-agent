import { describe, it, expect, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";
import { registerSigningTools } from "../src/tools/sign.js";
import { SigningServer } from "../src/signing/server.js";

/**
 * From a real Base → Arbitrum order (0.006 ETH, Verified Partner), with the
 * token documents in the nested shape GET /orders/:id actually returns. The
 * same invented-mock trap that hid the chainId bug applies here: a deposit
 * built from a made-up order is a deposit built for a shape the API never
 * sends.
 */
const CEX_ORDER = {
    houdiniId: "a9uEt2niVuXRotPZikzzh6",
    status: 0,
    isDex: false,
    // Relative, so the signer does not stop serving the page tomorrow.
    expires: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    depositAddress: "0xa2197016fe0fc61cd8a656d38d593cb125b87295",
    receiverAddress: "0xe75b49d793c835Caf6754C63AF2f0d472e537D73",
    inAmount: 0.006,
    inSymbol: "ETHBASE",
    outAmount: 0.005932,
    outSymbol: "ETHARB",
    inToken: {
        symbol: "ETH",
        address: null,
        decimals: 18,
        chainData: { name: "Base", shortName: "base", kind: "evm", chainId: 8453 },
    },
    outToken: {
        symbol: "ETH",
        address: null,
        decimals: 18,
        chainData: { name: "Arbitrum", shortName: "arbitrum", kind: "evm", chainId: 42161 },
    },
};

/** The same order paying in USDC, so the transfer is a token call. */
const USDC_ORDER = {
    ...CEX_ORDER,
    inAmount: 28,
    inSymbol: "USDCBASE",
    inToken: {
        symbol: "USDC",
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        decimals: 6,
        chainData: { name: "Base", shortName: "base", kind: "evm", chainId: 8453 },
    },
};

const stubClient = (order: unknown): HoudiniClient =>
    ({ get: async () => order, post: async () => ({}) }) as unknown as HoudiniClient;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
    await close?.();
    close = undefined;
});

const callDeposit = async (order: unknown, signer?: SigningServer) => {
    const server = new McpServer({ name: "t", version: "1" });
    const own = registerSigningTools(server, stubClient(order), signer);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
    await client.connect(ct);
    close = async () => {
        await own.close();
        await client.close();
    };
    const res = await client.callTool({
        name: "cexDepositRequest",
        arguments: { houdiniId: (order as { houdiniId?: string })?.houdiniId ?? "x" },
    });
    return JSON.parse((res.content as Array<{ text: string }>)[0].text);
};

describe("cexDepositRequest builds the transfer", () => {
    it("sends the native coin straight to the deposit address", async () => {
        const out = await callDeposit(CEX_ORDER);
        expect(out.error).toBeUndefined();
        expect(out.chainId).toBe(8453);

        const page = await fetch(out.url).then((r) => r.text());
        expect(page).toContain(CEX_ORDER.depositAddress);
        // 0.006 ETH in wei, exactly — not 6000000000000000.1
        expect(page).toContain("6000000000000000");
        expect(page).toContain("none — a plain transfer, no contract call");
    });

    it("sends an ERC-20 as a transfer call to the token, not to the exchange", async () => {
        const out = await callDeposit(USDC_ORDER);
        expect(out.error).toBeUndefined();

        const page = await fetch(out.url).then((r) => r.text());
        // to = the USDC contract; the deposit address rides inside the calldata
        expect(page).toContain("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
        expect(page).toContain("0xa9059cbb");
        expect(page).toContain("Token contract");
    });

    it("names the deposit address as the deposit address, not as the recipient", async () => {
        // The order's receiverAddress is where the swap pays out later. Showing
        // it as "Recipient" beside a transfer names the wrong destination in
        // the one row a careful user checks.
        const out = await callDeposit(CEX_ORDER);
        const page = await fetch(out.url).then((r) => r.text());
        expect(page).toContain("Deposit address");
        expect(page).toContain("Order pays out to");
        expect(page).not.toContain("<th>Recipient</th>");
        expect(page).toContain("Send your deposit");
    });

    it("shows the ticker from the token document, not the cex symbol", async () => {
        const out = await callDeposit(CEX_ORDER);
        const page = await fetch(out.url).then((r) => r.text());
        expect(page).toContain("0.006 ETH");
        expect(page).not.toContain("ETHBASE");
    });
});

describe("cexDepositRequest refuses what it cannot build safely", () => {
    it("sends a DEX order to dexSignRequest instead", async () => {
        const out = await callDeposit({ ...CEX_ORDER, isDex: true });
        expect(out.error).toContain("dexSignRequest");
        expect(out.url).toBeUndefined();
    });

    it("will not build a second page once the deposit has been seen", async () => {
        // status 1 is CONFIRMING: the funds are already there, and a second
        // page is an invitation to send twice.
        const out = await callDeposit({ ...CEX_ORDER, status: 1 });
        expect(out.error).toContain("past waiting");
        expect(out.url).toBeUndefined();
    });

    it("refuses a non-EVM deposit rather than signing through window.ethereum", async () => {
        const btc = {
            ...CEX_ORDER,
            depositAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            inToken: { symbol: "BTC", decimals: 8, chainData: { kind: "bitcoin" } },
        };
        const out = await callDeposit(btc);
        expect(out.error).toContain("not an EVM address");
        expect(out.url).toBeUndefined();
    });

    it("refuses an EVM address on a non-EVM chain", async () => {
        const out = await callDeposit({
            ...CEX_ORDER,
            inToken: { ...CEX_ORDER.inToken, chainData: { kind: "tron", chainId: 728126428 } },
        });
        expect(out.error).toContain("cannot sign");
        expect(out.url).toBeUndefined();
    });

    it("refuses when the token's decimals are unknown, rather than assuming 18", async () => {
        const out = await callDeposit({
            ...CEX_ORDER,
            inToken: { symbol: "ETH", address: null, chainData: { kind: "evm", chainId: 8453 } },
        });
        expect(out.error).toContain("decimals");
        expect(out.url).toBeUndefined();
    });

    it("refuses an amount that does not fit the token's decimals", async () => {
        const out = await callDeposit({ ...USDC_ORDER, inAmount: 28.0000001 });
        expect(out.error).toContain("does not fit");
        // and tells the user how to proceed by hand
        expect(out.error).toContain(CEX_ORDER.depositAddress);
        expect(out.url).toBeUndefined();
    });

    it("reports a missing deposit address plainly", async () => {
        const out = await callDeposit({ ...CEX_ORDER, depositAddress: undefined });
        expect(out.error).toContain("no deposit address");
        expect(out.url).toBeUndefined();
    });
});

describe("dexSignStatus after a deposit", () => {
    it("points at getOrder, never at dexConfirmTx", async () => {
        // dexConfirmTx does not apply to a CEX order and is charged at the
        // exchange tier ($0.01), so sending the agent there costs money for a
        // call that cannot help.
        const signer = new SigningServer();
        const req = await callDeposit(CEX_ORDER, signer);

        const hash = `0x${"b".repeat(64)}`;
        await fetch(req.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: new URL(req.url).origin },
            body: JSON.stringify({ txHash: hash }),
        });

        const server = new McpServer({ name: "t", version: "1" });
        registerSigningTools(server, stubClient(CEX_ORDER), signer);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await server.connect(st);
        const c = new Client({ name: "t", version: "1" }, { capabilities: {} });
        await c.connect(ct);
        const res = await c.callTool({ name: "dexSignStatus", arguments: { token: req.token } });
        const status = JSON.parse((res.content as Array<{ text: string }>)[0].text);

        expect(status.status).toBe("signed");
        expect(status.txHash).toBe(hash);
        expect(status.next).toContain("getOrder");
        expect(status.next).toContain("Do not call dexConfirmTx");

        await c.close();
        await signer.close();
    });
});
