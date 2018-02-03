import { IncomingMessage } from 'http';
import { ParsedPlan, parsePlan } from './parser';
import { gymHerzRequest } from './gym-herz-server';
import { ModifiedChecker } from './modified-checker';

class PlanFetcherClass {
    private plansCache: { [wd: string]: PlanRequest | ParsedPlan } = {};

    constructor() { }

    private async fetchPlanRequest(weekDay: string) {
        console.log('fetching plan', weekDay);
        const message: IncomingMessage = await gymHerzRequest.get({
            url: 'vertretung_filter/?wd=' + weekDay,
            gzip: true,
            encoding: 'latin1'
        });
        if (message.statusCode !== 200) {
            console.log('Bad response from www.gymnasium-herzogenaurach.de', message.statusCode, message.headers);
            throw new Error('Bad response from www.gymnasium-herzogenaurach.de: ' + message.statusCode);
        }
        return <string>(<any>message).body;
    }

    private async fetchPlan(weekDay: string, modified: Date) {
        const cacheValue = this.plansCache[weekDay];
        if (cacheValue) {
            if (cacheValue.modified.getTime() >= modified.getTime()) {
                return cacheValue instanceof PlanRequest ?
                    cacheValue.promise :
                    cacheValue;
            }
        }
        const promise = this.fetchPlanRequest(weekDay)
            .then((result) => {
                const parsedPlan = parsePlan(result, modified);
                this.plansCache[weekDay] = parsedPlan;
                return parsedPlan;
            })
            .catch((err) => {
                delete this.plansCache[weekDay];
                throw err;
            });
        this.plansCache[weekDay] = new PlanRequest(promise, modified);
        return promise;
    }

    public async getPlan(weekDay) {
        const modified = (await ModifiedChecker.getLastModified(weekDay)).modified;
        return this.fetchPlan(weekDay, modified);
    }

    public notifyPlanUpdate(weekDay: string, modified: Date) {
        this.fetchPlan(weekDay, modified)
            .catch((err) => {
                console.log('Error in notifyPlanUpdate', err.toString(), err.stack);
            });
    }
}

export const PlanFetcher = new PlanFetcherClass();

class PlanRequest {
    constructor(
        public promise: Promise<ParsedPlan | undefined>,
        public modified: Date) { }
}
