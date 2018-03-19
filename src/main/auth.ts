import { createHmac } from "crypto";

export const RENEW_PERIOD_WEEKS = 6;  // For client
export const EXPIRE_PERIOD_WEEKS = 8; // For server

const MILLIS_WEEK = 7 * 24 * 3600 * 1000;

const ALGO = 'sha256';
const HASH_LENGTH = 256 * 2;
if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET not set');
}
const AUTH_SECRET = <string>process.env.AUTH_SECRET;

function generateCookieValue() {
    const hmac = createHmac(ALGO, AUTH_SECRET);

    let date = Date.now();
    date = date / MILLIS_WEEK;
    date = Math.floor(date);
    const dateStr = date.toString(16).padStart(32, '0');
    hmac.update(dateStr);
    return dateStr + hmac.digest().toString('hex');
}

function getDateFromCookie(cookieValue: string) {
    if (cookieValue.length !== 32 + HASH_LENGTH) {
        return null;
    }
    const hmac = createHmac(ALGO, AUTH_SECRET);
    const dateStr = cookieValue.slice(0, 32);
    const digest = cookieValue.slice(32);
    hmac.update(dateStr);
    if (hmac.digest().toString('hex') !== digest) {
        return null;
    }
    let date = parseInt(dateStr, 16);
    date = date * MILLIS_WEEK;
    return new Date(date);
}
