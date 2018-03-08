import * as express from 'express';
import * as compression from 'compression';
import 'express-async-errors';
import * as path from 'path';
import { Server, createServer } from 'http';
import { plansApi } from './substitute-plans/api';
import { Scheduler } from './scheduler';
import { WebsocketServer } from './websocket';
import * as expressStaticGzip from 'express-static-gzip';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const STATIC_WWW_PATH = path.join(__dirname, '../www');

const HASH_IN_FILENAME_REGEX = /[0-9a-f]{20,}/;

export const API_PATH = '/api/v1'

class MyServer {

    public readonly app: express.Application;
    public readonly apiRouter: express.Router;
    public readonly server: Server;

    constructor() {
        this.app = express();
        this.config();

        this.staticWWW();

        this.apiRouter = express.Router();
        this.app.use(API_PATH, this.apiRouter);
        this.api();

        this.server = createServer(this.app);

        WebsocketServer.setup(this.server);
    }

    config() {
        this.app.disable('x-powered-by');
    }

    staticWWW() {
        this.app.use(expressStaticGzip(STATIC_WWW_PATH, {
            enableBrotli: true,
            setHeaders(res, filePath, stat) {
                filePath = filePath.replace(/\\/g, '/');
                const filename = filePath.substring(filePath.lastIndexOf('/'));
                if (HASH_IN_FILENAME_REGEX.test(filename)) {
                    res.set('cache-control', 'public, immutable, max-age=' + (6 * 30 * 24 * 3600));
                } else {
                    res.set('cache-control', 'public, max-age=' + (3 * 60));
                }
            }
        }));
    }

    api() {
        this.apiRouter.use(compression());
        plansApi(this.apiRouter);
    }

    public async start() {
        await Scheduler.start();
        this.server.listen(PORT, () => console.log(`Listening on ${PORT}`));
    }

}

new MyServer().start();
