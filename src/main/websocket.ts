import * as ws from 'ws';
import { API_PATH } from './server';
import { Server } from 'http';
import { promisify } from 'util';
import { ModifiedChecker } from './substitute-plans/modified-checker';

ws.prototype['sendAsync'] = promisify(ws.prototype.send);
declare class MyWebSocket extends ws {
    lastSendTime: number | undefined;

    sendAsync: (data: any) => Promise<void>;
}

class WebsocketServerClass {
    private server!: ws.Server;

    constructor() { }

    public setup(server: Server) {
        this.server = new ws.Server({
            server,
            path: API_PATH + '/websocket',
            verifyClient: this.verifyClient
        });

        this.server.on('error', this.handleError);
        this.server.on('connection', this.handleConnection);
    }

    private verifyClient: ws.VerifyClientCallbackSync = (info) => {
        //TODO auth
        return ['https://gh-app.tk',
            'https://backend-gh-app.herokuapp.com',
            'http://localhost:3000'].includes(info.origin);
    }

    private handleConnection = (socket: MyWebSocket) => {
        // maybe it helps, maybe not
        (<any>socket)._socket.setKeepAlive(true, 10);
        //console.log('Client connected');
        //socket.on('close', () => {
        //    console.log('Client disconnected')
        //});
        socket.on('error', (err) => {
            console.log('ws', err.message);
        });
        const sendPromise = promisify(socket.send.bind(socket));
        socket.on('message', (data) => {
            if (data === '') {
                if (!socket.lastSendTime || socket.lastSendTime + 30 * 1000 <= Date.now()) {
                    this.sendMessage(socket, '');
                }
                return;
            } else if (typeof data === 'string') {
                const clientDate = new Date(data);
                if (!isNaN(+clientDate)) {
                    const serverDate = ModifiedChecker.peekLatestModified();
                    if (serverDate > clientDate) {
                        this.sendMessage(socket, serverDate.toUTCString());
                    }
                    return;
            }
            }
            console.log('unknown message from ws client' + data);
        });
    }

    private sendMessage(socket: MyWebSocket, obj: any) {
        if (socket.readyState === ws.OPEN) {
            socket.sendAsync(obj).catch(this.handleError)
                .then(() => {
                    socket.lastSendTime = Date.now();
                });
        }
    }

    private handleError(err: Error) {
        console.log('ws', err.message);
    }

    public notifyAllModified(latestModifiedDate: Date) {
        const message = latestModifiedDate.toUTCString();
        this.server.clients.forEach((socket) => {
            this.sendMessage(<MyWebSocket>socket, message);
        })
    }
}

export const WebsocketServer = new WebsocketServerClass();
