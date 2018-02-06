import { IncomingMessage } from 'http';
import { ParsedPlan } from './parser';
import { PlanFetcher } from './plan-fetcher';
import { gymHerzRequest, WEEK_DAYS } from './gym-herz-server';
import { WebsocketServer } from '../websocket';

class ModifiedCheckerClass {
    private modifiedCache: { [wd: string]: Date | Promise<Date> | undefined } = {};
    private latestModifiedDate = new Date(-1);
    private lastCheckTime = 0;
    private globalNotifyLock = 0;
    private lastGlobalNotify = new Date(-1);

    constructor() { }

    private async checkModifiedRequest(weekDay: string, oldValue?: Date) {
        const options = {
            url: 'aktuelle_vertretungen/Woche/ressourcen007/schuelerplan_' + weekDay + '.htm',
        };
        if (oldValue) {
            options['headers'] = {
                'if-modified-since': oldValue.toUTCString()
            };
        }
        const message: IncomingMessage = await gymHerzRequest.head(options);
        const lastModified = message.headers['last-modified'];
        if (message.statusCode === 200 && lastModified) {
            return new Date(lastModified);
        } else if (message.statusCode === 304) {
            return (<Date>oldValue);
        }
        console.log('Bad response from www.gymnasium-herzogenaurach.de', message.statusCode, message.headers);
        throw new Error('Bad response from www.gymnasium-herzogenaurach.de: ' + message.statusCode);
    }

    private async checkModified(weekDay: string, deltaCheckMs: number) {
        const cacheValue = this.modifiedCache[weekDay];
        if (cacheValue) {
            if (!(cacheValue instanceof Date)) {
                return cacheValue;
            }
        }
        const promise = this.checkModifiedRequest(weekDay, cacheValue)
            .then((result) => {
                if (result === cacheValue) {
                    return result;
                }
                PlanFetcher.notifyPlanModified(weekDay, result);
                if (result > this.latestModifiedDate) {
                    this.latestModifiedDate = result;
                    this.tryNotifyGlobal();
                }
                this.modifiedCache[weekDay] = result;
                return result;
            })
            .catch((err) => {
                this.modifiedCache[weekDay] = undefined;
                throw err;
            });
        this.modifiedCache[weekDay] = promise;
        return promise;
    }

    // called by api endpoint
    public async getLatestModified() {
        await this.recheckAll(45000);
        return this.latestModifiedDate;
    }

    // called by websocket
    public peekLatestModified() {
        // just call don't await
        this.recheckAll(45000).catch((err) => {
            console.log('Error in recheckAll', err.toString(), err.stack);
        });
        return this.latestModifiedDate;
    }

    // called when plan is fetched by api endpoint
    public async getLastModifiedForDay(weekDay: string) {
        let cacheValue = this.modifiedCache[weekDay];
        if (!cacheValue) {
            await this.recheckAll(45000);
            cacheValue = this.modifiedCache[weekDay]
            if (!cacheValue) { throw new Error('should not happen in getLastModifiedForDay'); }
        }
        return cacheValue;
    }

    public async recheckAll(deltaCheckMs: number) {
        if (Date.now() < this.lastCheckTime + deltaCheckMs) {
            console.log('checkModified skipped: delta <', deltaCheckMs);
            return;
        }
        console.log('checkModified: delta >', deltaCheckMs);
        // lock to prevent multiple notifys
        this.globalNotifyLock++;
        try {
            await Promise.all(
                WEEK_DAYS.map((weekDay) => {
                    return this.checkModified(weekDay, deltaCheckMs);
                })
            );
            this.lastCheckTime = Date.now();
        } finally {
            this.globalNotifyLock--;
            this.tryNotifyGlobal();
        }
    }

    private tryNotifyGlobal() {
        if (this.globalNotifyLock > 0) {
            return;
        }
        if (this.latestModifiedDate > this.lastGlobalNotify) {
            console.log('notifyAllModified', this.latestModifiedDate);
            WebsocketServer.notifyAllModified(this.latestModifiedDate);
            this.lastGlobalNotify = this.latestModifiedDate;
        }
    }
}

export const ModifiedChecker = new ModifiedCheckerClass();
