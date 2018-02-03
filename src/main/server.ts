import * as express from 'express';
import 'express-async-errors';
import * as path from 'path';
import { Server, createServer } from 'http';
import { plansApi } from './substitute-plans/api';
import { setupWebsocket } from './weboscket';

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

        setupWebsocket(this.server);
    }

    config() {
        this.app.disable('x-powered-by');
    }

    routes() {
        this.app.use(express.static(PUBLIC));
    }

    api() {
        plansApi(this.apiRouter);
    }

    public start() {
        this.server.listen(PORT, () => console.log(`Listening on ${PORT}`));
    }

}

new MyServer().start();
