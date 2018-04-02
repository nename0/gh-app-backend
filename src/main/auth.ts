import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { IRouter, Response, Request } from 'express';
import * as cookieParser from 'cookie-parser';
import { parse as parseCookie } from 'cookie';
import * as vary from 'vary';
import { IncomingMessage } from 'http';

const MILLIS_WEEK = 7 * 24 * 3600 * 1000;

export const RENEW_PERIOD_WEEKS = 2;
export const RENEW_PERIOD_MILLIS = RENEW_PERIOD_WEEKS * MILLIS_WEEK;
export const EXPIRE_PERIOD_WEEKS = 8;
export const EXPIRE_PERIOD_MILLIS = EXPIRE_PERIOD_WEEKS * MILLIS_WEEK;

const ALGO = 'sha256';
const HASH_LENGTH_HEX = 256 / 4;
if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET not set');
}
const AUTH_SECRET = <string>process.env.AUTH_SECRET;

// we use both cookie and query param because cloudflare will ignore vary header
const COOKIE_KEY = 'AUTH_SESSION';
const AUTH_QUERY_KEY = 'auth';

const VALID_HASHES = [
    'c8054b63a920a0140cb07f76c83dd030a337b0f92cf80237b6bad98f2cc81cfa',
    'aaf9f2ee5c72b05c49251d8d28fb2dd87bd5ffb1bf84fdb734da182a7e1a9222'
].map((s) => new Buffer(s, 'hex'));

class AuthenticationManagerClass {
    sessionCookieParser = cookieParser(AUTH_SECRET);

    constructor() { }

    public setupApi(app: IRouter<any>) {
        app.use(this.sessionCookieParser);
        // login endpoint
        app.post('/auth/session', (req, res) => {
            if (!this.checkOrigin(req, res)) {
                return;
            }
            if (!req.body ||
                typeof req.body.username !== 'string' ||
                typeof req.body.password !== 'string') {
                res.status(400).send('Bad request body');
                return;
            }
            const authStr = req.body.username + ':' + req.body.password;
            const hasher = createHash(ALGO);
            hasher.update(authStr);
            const result = hasher.digest();
            if (!VALID_HASHES.some((validHash) => timingSafeEqual(validHash, result))) {
                res.status(401).send('Bad credentials');
                return;
            }
            this.setSessionCookie(res);
            res.status(204).send();
        });
        // logout endpoint
        app.delete('/auth/session', (req, res) => {
            this.clearSessionCookie(res);
            res.status(204).send();
        });
        // middleware to check cookie value
        app.use((req, res, next) => {
            if (!this.checkOrigin(req, res)) {
                return;
            }
            // the sessionCookieParser middleware will only set this value if signature is correct
            const cookieValue = req.signedCookies[COOKIE_KEY];
            // parse again to get raw value with signature and keep url formating
            const rawCookieValue = parseCookie(req.headers.cookie || '')[COOKIE_KEY];
            if (!cookieValue || !rawCookieValue) {
                res.status(401).send('missing ' + COOKIE_KEY + ' cookie');
                return;
            }
            if (rawCookieValue !== req.query[AUTH_QUERY_KEY]) {
                res.status(400).send(AUTH_QUERY_KEY + ' query param must be set to ' + COOKIE_KEY + ' cookie');
                return;
            }
            const weekValue = parseInt(cookieValue, 16) * RENEW_PERIOD_WEEKS;
            const diff = this.getWeeksValueFromDate(new Date()) - weekValue;
            if (diff > EXPIRE_PERIOD_WEEKS) {
                res.status(401).send('session expired');
                return;
            }
            if (diff > RENEW_PERIOD_WEEKS) {
                this.setSessionCookie(res);
            }
            next();
        });
    }

    public checkWebsocketConnection(req: IncomingMessage) {
        if (!this.checkOrigin(req)) {
            return false;
        }
        // manually call the middleware; it does not care if response is null
        this.sessionCookieParser(req, null, () => null);
        const signedCookies = req['signedCookies'];
        const strValue = signedCookies[COOKIE_KEY];
        if (!strValue) {
            return false;
        }
        const weekValue = parseInt(strValue, 16) * RENEW_PERIOD_WEEKS;
        const diff = this.getWeeksValueFromDate(new Date()) - weekValue;
        return diff <= EXPIRE_PERIOD_WEEKS;
    }

    private setSessionCookie(res: Response) {
        const cookieValue = this.getWeeksValueFromDate(new Date()) / RENEW_PERIOD_WEEKS;
        res.cookie(COOKIE_KEY, cookieValue.toString(16), {
            maxAge: EXPIRE_PERIOD_MILLIS,
            signed: true
        });
    }

    private clearSessionCookie(res: Response) {
        res.clearCookie(COOKIE_KEY, {
            maxAge: -1
        });
    }

    private getWeeksValueFromDate(date: Date) {
        let millis = date.getTime();
        millis = millis / MILLIS_WEEK;
        return Math.floor(millis);
    }

    private checkOrigin(req: IncomingMessage, res?: Response) {
        if (!req.headers['origin']) {
            return true;
        }
        const isKnown = ['https://gh-app.tk',
            'https://backend-gh-app.herokuapp.com',
            'http://localhost:9000',
            'http://geccom:9000']
            .includes(<string>req.headers['origin']);
        if (!isKnown) {
            if (res) {
                res.status(403).send('Unknown Origin');
            }
            return false;
        }
        return true;
    }
}

export const AuthenticationManager = new AuthenticationManagerClass();
