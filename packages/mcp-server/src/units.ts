/**
 * Amount and calldata helpers for building a deposit transfer.
 *
 * No arithmetic here goes through a float. `0.006 * 1e18` is 6000000000000000.1
 * in IEEE-754 and `28.1 * 1e6` is 28099999.999999996 — both silently wrong by
 * the time they reach a wallet. Everything below works on the decimal string,
 * which is exact.
 */

/** `transfer(address,uint256)` */
const TRANSFER_SELECTOR = "a9059cbb";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const isEvmAddress = (value: unknown): value is string =>
    typeof value === "string" && EVM_ADDRESS.test(value);

/**
 * Converts a decimal amount to base units, exactly, or returns undefined when
 * it cannot be done without changing the number.
 *
 * `String(n)` gives the shortest representation that round-trips to the same
 * double, which is also the figure the user was shown — so the string is the
 * honest source, not the float behind it.
 *
 * Refuses rather than truncates. A deposit that is quietly rounded down is a
 * deposit the exchange may re-rate or reject, and the user would have no way to
 * see which of the two amounts was actually sent.
 */
export const toBaseUnits = (amount: number | string, decimals: number): string | undefined => {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;

    const text = typeof amount === "number" ? String(amount) : amount.trim();
    // Rejects "-1", "NaN", "Infinity" and "" along with anything non-numeric.
    // A negative or non-finite deposit is never a thing we should build.
    const parts = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!parts) return undefined;

    const [, whole, fraction = "", exponent] = parts;
    const digits = whole + fraction;
    // Where the decimal point sits within `digits` once the exponent is applied.
    let point = whole.length + (exponent ? Number.parseInt(exponent, 10) : 0);

    let padded = digits;
    if (point <= 0) {
        padded = "0".repeat(-point) + digits;
        point = 0;
    } else if (point > digits.length) {
        padded = digits + "0".repeat(point - digits.length);
    }

    const intPart = padded.slice(0, point);
    // Trailing zeros are not precision: 1.500 in a 2-decimal token is fine.
    const fracPart = padded.slice(point).replace(/0+$/, "");
    if (fracPart.length > decimals) return undefined;

    const scaled = `${intPart}${fracPart.padEnd(decimals, "0")}`;
    const trimmed = scaled.replace(/^0+(?=\d)/, "");
    return trimmed === "" ? "0" : trimmed;
};

/**
 * Calldata for an ERC-20 transfer. Built by hand because the server has no web3
 * dependency and this is 4 bytes plus two words — pulling in a library to
 * concatenate them would be the larger risk.
 */
export const erc20TransferData = (recipient: string, amountBaseUnits: string): string | undefined => {
    if (!isEvmAddress(recipient)) return undefined;
    let amount: bigint;
    try {
        amount = BigInt(amountBaseUnits);
    } catch {
        return undefined;
    }
    if (amount < 0n) return undefined;

    const to = recipient.slice(2).toLowerCase().padStart(64, "0");
    const value = amount.toString(16).padStart(64, "0");
    // A uint256 cannot be wider than 32 bytes; if it is, the amount is nonsense
    // and would silently overflow into the next word.
    if (value.length > 64) return undefined;
    return `0x${TRANSFER_SELECTOR}${to}${value}`;
};
