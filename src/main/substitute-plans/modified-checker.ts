import { IncomingMessage } from 'http';
import { ParsedPlan } from './parser';
import { PlanFetcher } from './plan-fetcher';
import { gymHerzRequest, WEEK_DAYS } from './gym-herz-server';

class ModifiedCheckerClass {
    private modifiedCache: { [wd: string]: ModifiedCacheValue | Promise<ModifiedCacheValue> } = {};

    constructor() { }

    private async checkModifiedRequest(weekDay: string, oldValue?: ModifiedCacheValue) {
        const options = {
            url: 'aktuelle_vertretungen/Woche/ressourcen007/schuelerplan_' + weekDay + '.htm',
        };
        if (oldValue) {
            options['headers'] = {
                'if-modified-since': oldValue.modified.toUTCString()
            };
        }
        console.log('checkModified', weekDay);
        const message: IncomingMessage = await gymHerzRequest.head(options);
        const lastModified = message.headers['last-modified'];
        if (message.statusCode === 200 && lastModified) {
            return new ModifiedCacheValue(
                new Date(lastModified),
                Date.now());
        } else if (message.statusCode === 304) {
            (<ModifiedCacheValue>oldValue).lastCheck = Date.now();
            return (<ModifiedCacheValue>oldValue);
        }
        console.log('Bad response from www.gymnasium-herzogenaurach.de', message.statusCode, message.headers);
        throw new Error('Bad response from www.gymnasium-herzogenaurach.de: ' + message.statusCode);
    }

    private async checkModified(weekDay: string, deltaCheck: number) {
        const cacheValue = this.modifiedCache[weekDay];
        if (cacheValue) {
            if (!(cacheValue instanceof ModifiedCacheValue)) {
                return cacheValue;
            }
            if (Date.now() < cacheValue.lastCheck + deltaCheck) {
                console.log('checkModified', weekDay, ' skipped');
                return cacheValue;
            }
        }
        const promise = this.checkModifiedRequest(weekDay, cacheValue)
            .then((result) => {
                if (result !== cacheValue) {
                    PlanFetcher.notifyPlanUpdate(weekDay, result.modified)
                }
                this.modifiedCache[weekDay] = result;
                return result;
            })
            .catch((err) => {
                delete this.modifiedCache[weekDay];
                throw err;
            });
        this.modifiedCache[weekDay] = promise;
        return promise;
    }

    public async getLatestModified() {
        let result = -1;
        await Promise.all(
            WEEK_DAYS.map(async (weekDay) => {
                const cacheValue = await this.checkModified(weekDay, 20000);
                if (!cacheValue) {
                    return;
                }
                if (cacheValue.modified.getTime() > result) {
                    result = cacheValue.modified.getTime();
                }
            })
        );
        const date = new Date();
        date.setTime(result);
        return date;
    }

    public getLastModified(weekDay: string) {
        return this.checkModified(weekDay, 20000);
    }

    public async recheckAll() {
        await Promise.all(
            WEEK_DAYS.map((weekDay) => {
                return this.checkModified(weekDay, 10000);
            })
        );
    }
}

export const ModifiedChecker = new ModifiedCheckerClass();

class ModifiedCacheValue {
    constructor(
        public modified: Date,
        public lastCheck: number) { }
}
