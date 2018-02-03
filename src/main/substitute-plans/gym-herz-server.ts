import { Agent } from 'http';

const agent = new Agent({
    keepAlive: true,
    keepAliveMsecs: 90000
})

export const gymHerzRequest = require('request-promise-native')
    .defaults({
        baseUrl: 'http://www.gymnasium-herzogenaurach.de/',
        resolveWithFullResponse: true,
        simple: false,
        agent
    });

export const WEEK_DAYS = ['mo', 'di', 'mi', 'do', 'fr'];
