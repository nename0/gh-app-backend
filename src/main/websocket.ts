import * as ws from 'ws';
import { API_PATH } from './server';
import { Server } from 'http';
import { promisify } from 'util';
import { ModificationChecker } from './substitute-plans/modification-checker';
import { WSMESSAGE_LAST_MODIFICATION_QUERY, WSMESSAGE_LAST_MODIFICATION_UPDATE, WSMESSAGE_PUSH_SUBSCRIPTION } from './websocket-mesages';

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
            'http://localhost:9000',
            'http://geccom:9000'].includes(info.origin);
    }

    private handleConnection = (socket: MyWebSocket) => {
        (<any>socket)._socket.setTimeout(55000);
        //console.log('Client connected');
        //socket.on('close', () => {
        //    console.log('Client disconnected')
        //});
        socket.on('error', (err) => {
            console.log('ws', err.message);
        });
        socket.on('message', this.handleMesage(socket));
    }

    private handleMesage(socket: MyWebSocket) {
        return (data) => {
            if (data === '') {
                if (!socket.lastSendTime || socket.lastSendTime + 30 * 1000 <= Date.now()) {
                    this.sendMessage(socket, '');
                }
                return;
            } else if (typeof data === 'string') {
                if (data.startsWith(WSMESSAGE_LAST_MODIFICATION_QUERY)) {
                    const clientDate = new Date(data.slice(WSMESSAGE_LAST_MODIFICATION_QUERY.length));
                    if (!isNaN(+clientDate)) {
                        const serverDate = ModificationChecker.peekLatestModification();
                        if (serverDate > clientDate) {
                            this.sendMessage(socket, WSMESSAGE_LAST_MODIFICATION_UPDATE + serverDate.toUTCString());
                        } else {
                            this.sendMessage(socket, '');
                        }
                        return;
                    }
                } else if (data.startsWith(WSMESSAGE_PUSH_SUBSCRIPTION)) {
                    //TODO
                    return;
                }
            }
            console.log('unknown message from ws client' + data);
        }
    }

    private sendMessage(socket: MyWebSocket, obj: any) {
        if (socket.readyState === ws.OPEN) {
            socket.sendAsync(obj).then(() => {
                socket.lastSendTime = Date.now();
            }).catch(this.handleError);
        }
    }

    private handleError(err: Error) {
        console.log('ws', err.message);
    }

    public notifyAllModification(latestModificationDate: Date) {
        const message = WSMESSAGE_LAST_MODIFICATION_UPDATE + latestModificationDate.toUTCString();
        this.server.clients.forEach((socket) => {
            this.sendMessage(<MyWebSocket>socket, message);
        })
    }
}

export const WebsocketServer = new WebsocketServerClass();
