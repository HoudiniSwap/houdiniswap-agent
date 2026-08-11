import { describe, it, expect } from "vitest";
import { erc20TransferData, isEvmAddress, toBaseUnits } from "../src/units.js";

/**
 * These cover the arithmetic that decides how much leaves someone's wallet, so
 * each case is a way of getting it wrong rather than a way of getting it right.
 */
describe("toBaseUnits", () => {
    it("scales a native amount without going through a float", () => {
        // 0.006 * 1e18 is 6000000000000000.1 as a double. The string path is
        // exact, and this is the amount from a real deposit.
        expect(toBaseUnits(0.006, 18)).toBe("6000000000000000");
        expect(toBaseUnits(0.1, 18)).toBe("100000000000000000");
    });

    it("scales a token amount to its own decimals, not to 18", () => {
        expect(toBaseUnits(28, 6)).toBe("28000000");
        expect(toBaseUnits(1.5, 6)).toBe("1500000");
    });

    it("expands exponent notation, which is how String() prints small numbers", () => {
        // String(6e-7) === "6e-7". Parsed naively this reads as 6.
        expect(toBaseUnits(6e-7, 18)).toBe("600000000000");
        expect(toBaseUnits(1e21, 0)).toBe("1000000000000000000000");
    });

    it("treats trailing zeros as absent rather than as precision", () => {
        expect(toBaseUnits("1.500", 2)).toBe("150");
        expect(toBaseUnits("2.00", 0)).toBe("2");
    });

    it("refuses precision the token cannot hold instead of rounding it away", () => {
        // A deposit quietly rounded down is one the exchange may re-rate, and
        // the user cannot see which of the two amounts was actually sent.
        expect(toBaseUnits(0.0000001, 6)).toBeUndefined();
        expect(toBaseUnits("1.0000000000000000001", 18)).toBeUndefined();
    });

    it("refuses anything that is not a positive finite decimal", () => {
        expect(toBaseUnits(-1, 18)).toBeUndefined();
        expect(toBaseUnits(Number.NaN, 18)).toBeUndefined();
        expect(toBaseUnits(Number.POSITIVE_INFINITY, 18)).toBeUndefined();
        expect(toBaseUnits("", 18)).toBeUndefined();
        expect(toBaseUnits("abc", 18)).toBeUndefined();
        expect(toBaseUnits(1, -1)).toBeUndefined();
    });

    it("keeps zero as zero rather than an empty string", () => {
        expect(toBaseUnits(0, 18)).toBe("0");
    });
});

describe("erc20TransferData", () => {
    const DEPOSIT = "0xa2197016fe0fc61cd8a656d38d593cb125b87295";

    it("packs the selector and two 32-byte words", () => {
        const data = erc20TransferData(DEPOSIT, "28000000");
        expect(data).toBe(
            "0xa9059cbb" +
                "000000000000000000000000a2197016fe0fc61cd8a656d38d593cb125b87295" +
                "0000000000000000000000000000000000000000000000000000000001ab3f00",
        );
        // 4-byte selector plus two words, or the ABI decoder reads the next
        // word as the amount.
        expect(data).toHaveLength(2 + 8 + 64 + 64);
    });

    it("refuses a recipient that is not an address", () => {
        expect(erc20TransferData("not-an-address", "1")).toBeUndefined();
        expect(erc20TransferData("0xabc", "1")).toBeUndefined();
    });

    it("refuses an amount it cannot read", () => {
        expect(erc20TransferData(DEPOSIT, "1.5")).toBeUndefined();
        expect(erc20TransferData(DEPOSIT, "-1")).toBeUndefined();
    });
});

describe("isEvmAddress", () => {
    it("accepts a 20-byte hex address and nothing else", () => {
        expect(isEvmAddress("0xa2197016fe0fc61cd8a656d38d593cb125b87295")).toBe(true);
        // A Bitcoin address reaching an EVM transfer builder is the case that
        // has to fail loudly.
        expect(isEvmAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(false);
        expect(isEvmAddress(undefined)).toBe(false);
        expect(isEvmAddress("0x")).toBe(false);
    });
});
