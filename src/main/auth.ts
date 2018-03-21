import { createHmac } from 'crypto';
import { IRouter } from 'express';

export const RENEW_PERIOD_WEEKS = 6;  // For client
export const EXPIRE_PERIOD_WEEKS = 8; // For server

const MILLIS_WEEK = 7 * 24 * 3600 * 1000;

const ALGO = 'sha256';
const HASH_LENGTH_HEX = 256 / 4;
if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET not set');
}
const AUTH_SECRET = <string>process.env.AUTH_SECRET;

class AuthenticationManagerClass {
    constructor() { }

    public setupApi(app: IRouter<any>) {
        app.post('/auth/session', function(req, res) {
            if (!req.body || !req.body.username || !req.body.password) {
                res.status(400).send('Bad request body');
            }
        });
    }

    private generateCookieValue() {
        const hmac = createHmac(ALGO, AUTH_SECRET);
    
        const dateStr = this.getWeekFromDate(new Date())
            .toString(16).padStart(8, '0');
        hmac.update(dateStr);
        return dateStr + hmac.digest().toString('hex');
    }
    
    private getWeekFromDate(date: Date) {
        let millis = date.getTime();
        millis = millis / MILLIS_WEEK;
        return Math.floor(millis);
    }
    
    private getWeekFromCookie(cookieValue?: string) {
        if (!cookieValue || cookieValue.length !== 8 + HASH_LENGTH_HEX) {
            return null;
        }
        const hmac = createHmac(ALGO, AUTH_SECRET);
        const dateStr = cookieValue.slice(0, 8);
        const digest = cookieValue.slice(8);
        hmac.update(dateStr);
        if (hmac.digest().toString('hex') !== digest) {
            return null;
        }
        return parseInt(dateStr, 16);
    }
}

export const AuthenticationManager = new AuthenticationManagerClass();

const x = generateCookieValue();
console.log(x);
console.log(x);
console.log(x);
console.log(x);
