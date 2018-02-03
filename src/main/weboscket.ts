import { Server } from 'ws';
import { API_PATH } from './server';

export function setupWebsocket(server) {
    const wss = new Server({
        server,
        path: API_PATH + '/websocket',
        verifyClient: (info: { origin: string }): boolean => {
            return ['https://gh-app.tk',
                'https://backend-gh-app.herokuapp.com',
                'http://localhost:3000'].includes(info.origin);
        }
    });

    wss.on('connection', (ws) => {
        (<any>ws)._socket.setKeepAlive(true, 10);
        //(<any>ws)._socket.setTimeout(5000);
        console.log('Client connected');
        ws.on('close', () => {
            console.log('Client disconnected')
        });
        ws.on('error', (err) => {
            console.log(err.message);
        });
        ws.on('message', (data) => {
            console.log('Message from client', data);
        });
        ws.on('ping', (data) => {
            console.log('Ping from client', data);
        });
    });

    //setInterval(() => {
    //    wss.clients.forEach((client) => {
    //        client.send(new Date().toTimeString());
    //    });
    //}, 1000);
}
