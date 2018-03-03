import { IncomingMessage } from 'http';
import { ParsedPlan, parsePlan } from './parser';
import { gymHerzRequest } from './gym-herz-server';
import { ModificationChecker } from './modification-checker';
import { PushMessaging } from '../push';
import { Database } from '../db';

class PlanFetcherClass {
    private plansCache: { [wd: string]: PlanRequest | ParsedPlan | undefined } = {};

    private globalNotifyLock = 0;
    private daysToNotify: Set<string> = new Set();

    constructor() { }

    private async fetchPlanRequest(weekDay: string) {
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

    private fetchPlan(weekDay: string, modification: Date) {
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
    public async notifyPlanModification(weekDay: string, modification: Date) {
        this.globalNotifyLock++;
        try {
            await this.fetchPlan(weekDay, modification);
            this.daysToNotify.add(weekDay);
        } catch (err) {
            console.log('Error in PlanFetcher.fetchPlan', err.toString(), err.stack);
        } finally {
            this.globalNotifyLock--;
            this.tryNotifyGlobal();
        }
    }

    public async tryNotifyGlobal() {
        if (ModificationChecker.isChecking || this.globalNotifyLock > 0) {
            return;
        }
        if (this.daysToNotify.size > 0) {
            const array = Array.from(this.daysToNotify)
            console.log('notifyPlanModifications ' + array);
            this.daysToNotify.clear();
            this.globalNotifyLock++;
            try {
                const plans = await Promise.all(array.map((weekDay) => {
                    const cacheValue = this.plansCache[weekDay];
                    if (!cacheValue) {
                        throw new Error('cacheValue for ' + weekDay + ' was undefined');
                    }
                    if (cacheValue instanceof PlanRequest) {
                        return cacheValue.promise;
                    }
                    return cacheValue;
                }));
                await PushMessaging.notifyPlanModifications(plans);
            } catch (err) {
                console.log('Error in PlanFetcher.tryNotifyGlobal', err.toString(), err.stack);
                array.forEach((wd) => this.daysToNotify.add(wd));
            } finally {
                this.globalNotifyLock--;
                setImmediate(() => this.tryNotifyGlobal());
            }
        }
    }
}

export const PlanFetcher = new PlanFetcherClass();

class PlanRequest {
    constructor(
        public promise: Promise<ParsedPlan>,
        public modification: Date) { }
}
