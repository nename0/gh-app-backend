import { IncomingMessage } from 'http';
import { ParsedPlan, parsePlan } from './parser';
import { gymHerzRequest } from './gym-herz-server';
import { ModificationChecker } from './modification-checker';

class PlanFetcherClass {
    private plansCache: { [wd: string]: PlanRequest | ParsedPlan | undefined } = {};

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

    private async fetchPlan(weekDay: string, modification: Date) {
        const cacheValue = this.plansCache[weekDay];
        if (cacheValue) {
            if (cacheValue.modification >= modification) {
                return cacheValue instanceof PlanRequest ?
                    cacheValue.promise :
                    cacheValue;
            }
        }
        const promise = this.fetchPlanRequest(weekDay)
            .then((result) => {
                const parsedPlan = parsePlan(weekDay, modification, result);
                this.plansCache[weekDay] = parsedPlan;
                return parsedPlan;
            })
            .catch((err) => {
                this.plansCache[weekDay] = undefined;
                throw err;
            });
        this.plansCache[weekDay] = new PlanRequest(promise, modification);
        return promise;
    }

    // called by api endpoint
    public async getPlan(weekDay) {
        const modification = await ModificationChecker.getLastModificationForDay(weekDay);
        return this.fetchPlan(weekDay, modification);
    }

    // called by ModificationChecker
    public notifyPlanModification(weekDay: string, modification: Date) {
        this.fetchPlan(weekDay, modification)
            .catch((err) => {
                console.log('Error in notifyPlanUpdate', err.toString(), err.stack);
            });
    }
}

export const PlanFetcher = new PlanFetcherClass();

class PlanRequest {
    constructor(
        public promise: Promise<ParsedPlan>,
        public modification: Date) { }
}
