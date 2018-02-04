import * as ws from 'ws';
import { API_PATH } from './server';
import { Server } from 'http';
import { promisify } from 'util';

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

    private verifyClient = (info: { origin: string }): boolean => {
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
            } else {
                console.log('unknown message from ws client', data);
            }
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

    public notifyAllModified() {
        this.server.clients.forEach((socket) => {
            this.sendMessage(<MyWebSocket>socket, 'notifyModified');
        })
    }
}

export const WebsocketServer = new WebsocketServerClass();
