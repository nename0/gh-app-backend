import * as ws from 'ws';
import { API_PATH } from './server';
import { Server, IncomingMessage } from 'http';
import { promisify } from 'util';
import { ModificationChecker } from './substitute-plans/modification-checker';
import { WSMESSAGE_PUSH_SUBSCRIPTION, WSMESSAGE_MODIFICATION_HASH_UPDATE, WSMESSAGE_MODIFICATION_HASH_QUERY } from './websocket-mesages';
import { URLSearchParams } from 'url';
import { PushMessaging } from './push';

ws.prototype['sendAsync'] = promisify(ws.prototype.send);
declare class MyWebSocket extends ws {
    lastSendTime: number | undefined;

    fingerprint: string;

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

    private handleConnection = (socket: MyWebSocket, req: IncomingMessage) => {
        (<any>socket)._socket.setTimeout(55000);
        //console.log('Client connected');
        //socket.on('close', () => {
        //    console.log('Client disconnected')
        //});
        const url: string = <string>req.url;
        const searchParams = new URLSearchParams(url.slice(url.indexOf('?')));
        const fingerprint = searchParams.get('fingerprint');
        if (!fingerprint || fingerprint.length !== 56) {
            socket.close(1002, 'missing fingerprint');
            return;
        }
        socket.fingerprint = fingerprint;
        socket.on('error', this.handleError);
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
                if (data.startsWith(WSMESSAGE_MODIFICATION_HASH_QUERY)) {
                    const clientHash = data.substring(WSMESSAGE_MODIFICATION_HASH_QUERY.length);
                    const serverHash = ModificationChecker.modificationHash;
                    if (serverHash === '') {
                        // not yet loaded
                        return;
                    }
                    if (clientHash !== serverHash) {
                        this.sendMessage(socket, WSMESSAGE_MODIFICATION_HASH_UPDATE + serverHash);
                    } else {
                        this.sendMessage(socket, '');
                    }
                    return;
                } else if (data.startsWith(WSMESSAGE_PUSH_SUBSCRIPTION)) {
                    if (PushMessaging.onWebsocketMessage(
                        socket.fingerprint,
                        data.substring(WSMESSAGE_PUSH_SUBSCRIPTION.length))) {
                        this.sendMessage(socket, '');
                        return;
                    }
                    socket.close(1002, 'bad request');
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

    public notifyModificationHash(latestModificationDate: string) {
        const message = WSMESSAGE_MODIFICATION_HASH_UPDATE + latestModificationDate;
        this.server.clients.forEach((socket) => {
            this.sendMessage(<MyWebSocket>socket, message);
        })
    }

    public isBrowserConnected(fingerprint: string) {
        for (const client of <Set<MyWebSocket>>this.server.clients) {
            if (client.fingerprint === fingerprint) {
                return true;
            }
        }
        return false;
    }
}

export const WebsocketServer = new WebsocketServerClass();
