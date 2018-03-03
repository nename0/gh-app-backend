import { Agent } from 'http';

export const WEEK_DAYS = ['mo', 'di', 'mi', 'do', 'fr'];

const agent = new Agent({
    keepAlive: true,
    maxSockets: 6
});

// to prevent DDOSing the server
export const REQUEST_RETRY_TIME = 2500;

export const gymHerzRequest = require('request-promise-native')
    .defaults({
        baseUrl: 'http://www.gymnasium-herzogenaurach.de/',
        resolveWithFullResponse: true,
        simple: false,
        timeout: 4000,
        agent
    });
