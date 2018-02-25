import * as express from 'express';
import * as compression from 'compression';
import 'express-async-errors';
import * as path from 'path';
import { Server, createServer } from 'http';
import { plansApi } from './substitute-plans/api';
import { Scheduler } from './scheduler';
import { WebsocketServer } from './websocket';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC = path.join(__dirname, '../www');

export const API_PATH = '/api/v1'

class MyServer {

    public readonly app: express.Application;
    public readonly apiRouter: express.Router;
    public readonly server: Server;

    constructor() {
        this.app = express();
        this.config();

        this.routes();

        this.apiRouter = express.Router();
        this.app.use(API_PATH, this.apiRouter);
        this.api();

        this.server = createServer(this.app);

        WebsocketServer.setup(this.server);
    }

    config() {
        this.app.disable('x-powered-by');
    }

    routes() {
        this.app.use(express.static(PUBLIC));
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
