import { Agent } from 'http';
import * as request_promised from 'request-promise-native';

export const WEEK_DAYS = ['mo', 'di', 'mi', 'do', 'fr'];

export function getWeekDayShortStr(wd: string): string {
    return wd[0].toUpperCase() + wd[1];
}

let agent;

let gymHerzRequest;

// to prevent DDOSing the server
export const REQUEST_RETRY_TIME = 2500;

onRequestSocketTimeout();
export function onRequestSocketTimeout() {
    if (agent) {
        console.log('onRequestSocketTimeout');
        agent.destroy();
    }
    agent = new Agent({
        keepAlive: true,
        maxSockets: 6
    });
    gymHerzRequest = request_promised
        .defaults({
            baseUrl: 'http://www.gymnasium-herzogenaurach.de/',
            resolveWithFullResponse: true,
            simple: false,
            timeout: 4000,
            agent
        });
}

export function getGymHerzRequest() {
    return gymHerzRequest;
}
