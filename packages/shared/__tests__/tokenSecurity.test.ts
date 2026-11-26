import { describe, it, expect } from "vitest";
import { tokenSecurityDisplay, checkSwapTokens, swapRiskConfirmation } from "../src/tokenSecurity.js";
import type { Token } from "../src/types.js";

const token = (id: string, securityScan?: unknown) => ({ id, symbol: id.toUpperCase(), securityScan }) as unknown as Token;

describe("tokenSecurityDisplay (the site's popup rule)", () => {
    it("always shows Malicious, with or without findings", () => {
        expect(tokenSecurityDisplay({ resultType: "Malicious" })).toEqual({ variant: "malicious", flags: [] });
        expect(tokenSecurityDisplay({ resultType: "malicious", features: [{ featureId: "UNLISTED" }] })).toEqual({
            variant: "malicious",
            flags: [],
        });
    });

    it("shows Warning only with a finding the site lists", () => {
        expect(tokenSecurityDisplay({ resultType: "Warning" })).toBeNull();
        expect(tokenSecurityDisplay({ resultType: "Warning", features: [{ featureId: "UNLISTED" }] })).toBeNull();
        expect(tokenSecurityDisplay({ resultType: "Warning", features: [{ featureId: "SNIPE_AT_MINT" }] })).toEqual({
            variant: "warning",
            flags: ["Sniped at mint"],
        });
    });

    it("passes Benign, Unscanned and missing verdicts", () => {
        for (const scan of [{ resultType: "Benign" }, { resultType: "Unscanned" }, undefined, null, {}, "Malicious"]) {
            expect(tokenSecurityDisplay(scan)).toBeNull();
        }
    });

    it("orders findings by severity, lists a shared label once and keeps three", () => {
        const display = tokenSecurityDisplay({
            resultType: "Malicious",
            features: [
                { featureId: "LOW_REPUTATION_CREATOR" },
                { featureId: "IMPERSONATOR" },
                { featureId: "IMPERSONATOR_HIGH_CONFIDENCE" },
                { featureId: "SNIPE_AT_MINT" },
                { featureId: "HONEYPOT" },
            ],
        });
        expect(display?.flags).toEqual(["Honeypot risk", "Impersonates other token", "Sniped at mint"]);
    });

    it("shows confidence variants of one finding once, as the most severe", () => {
        // Seen on a real token: the site shows only "Impersonates other token".
        const display = tokenSecurityDisplay({
            resultType: "Malicious",
            features: [{ featureId: "IMPERSONATOR_MEDIUM_CONFIDENCE" }, { featureId: "IMPERSONATOR" }],
        });
        expect(display?.flags).toEqual(["Impersonates other token"]);
    });
});

describe("checkSwapTokens", () => {
    it("keeps a stored Malicious verdict that the quote reports as Unscanned", () => {
        const { unaccepted } = checkSwapTokens([
            { token: token("eth", { resultType: "Malicious" }), quoteScan: { resultType: "Unscanned" }, label: "ETH on ethereum" },
        ]);
        expect(unaccepted.map(f => f.variant)).toEqual(["malicious"]);
    });

    it("lets the quote's fresh verdict clear a stored Warning, but not a stored Malicious", () => {
        const storedWarning = token("w", { resultType: "Warning", features: [{ featureId: "HONEYPOT" }] });
        expect(checkSwapTokens([{ token: storedWarning, quoteScan: { resultType: "Benign" }, label: "W" }]).flagged).toEqual([]);
        expect(checkSwapTokens([{ token: storedWarning, quoteScan: { resultType: "Unscanned" }, label: "W" }]).flagged).toHaveLength(1);
        expect(checkSwapTokens([{ token: storedWarning, label: "W" }]).flagged).toHaveLength(1);
        const storedMalicious = token("m", { resultType: "Malicious" });
        expect(checkSwapTokens([{ token: storedMalicious, quoteScan: { resultType: "Benign" }, label: "M" }]).flagged).toHaveLength(1);
    });

    it("lists accepted tokens as flagged but not as unaccepted", () => {
        const { flagged, unaccepted } = checkSwapTokens(
            [
                { token: token("a"), quoteScan: { resultType: "Malicious" }, label: "A on x" },
                { token: token("b"), quoteScan: { resultType: "Malicious" }, label: "B on y" },
            ],
            ["a"],
        );
        expect(flagged.map(f => f.tokenId)).toEqual(["a", "b"]);
        expect(unaccepted.map(f => f.tokenId)).toEqual(["b"]);
    });

    it("words the confirmation with the site's text and the ids to accept", () => {
        const { unaccepted } = checkSwapTokens([
            { token: token("a"), quoteScan: { resultType: "Warning", features: [{ featureId: "HONEYPOT" }] }, label: "A on x" },
        ]);
        const answer = swapRiskConfirmation(unaccepted);
        expect(answer.confirmationRequired).toBe(true);
        expect(answer.acceptRiskTokenIds).toEqual(["a"]);
        expect(answer.flaggedTokens[0].warning).toMatch(/^Honeypot risk: A on x has been flagged as suspicious/);
    });
});
