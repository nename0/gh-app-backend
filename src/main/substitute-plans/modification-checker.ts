import { IncomingMessage } from 'http';
import { ParsedPlan } from './parser';
import { PlanFetcher } from './plan-fetcher';
import { gymHerzRequest, WEEK_DAYS } from './gym-herz-server';
import { WebsocketServer } from '../websocket';

class ModificationCheckerClass {
    private modificationCache: { [wd: string]: Date | Promise<Date> | undefined } = {};
    private latestModificationDate = new Date(-1);
    private lastCheckTime = 0;
    private globalNotifyLock = 0;
    private lastGlobalNotify = new Date(-1);

    constructor() { }

    private async checkModificationRequest(weekDay: string, oldValue?: Date) {
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

    private async checkModification(weekDay: string, deltaCheckMs: number) {
        const cacheValue = this.modificationCache[weekDay];
        if (cacheValue) {
            if (!(cacheValue instanceof Date)) {
                return cacheValue;
            }
        }
        const promise = this.checkModificationRequest(weekDay, cacheValue)
            .then((result) => {
                if (result === cacheValue) {
                    return result;
                }
                PlanFetcher.notifyPlanModification(weekDay, result);
                if (result > this.latestModificationDate) {
                    this.latestModificationDate = result;
                    this.tryNotifyGlobal();
                }
                this.modificationCache[weekDay] = result;
                return result;
            })
            .catch((err) => {
                this.modificationCache[weekDay] = undefined;
                throw err;
            });
        this.modificationCache[weekDay] = promise;
        return promise;
    }

    // called by api endpoint
    public async getLatestModification() {
        await this.recheckAll(45000);
        return this.latestModificationDate;
    }

    // called by websocket
    public peekLatestModification() {
        // just call don't await
        this.recheckAll(45000).catch((err) => {
            console.log('Error in recheckAll', err.toString(), err.stack);
        });
        return this.latestModificationDate;
    }

    // called when plan is fetched by api endpoint
    public async getLastModificationForDay(weekDay: string) {
        let cacheValue = this.modificationCache[weekDay];
        if (!cacheValue) {
            await this.recheckAll(45000);
            cacheValue = this.modificationCache[weekDay]
            if (!cacheValue) { throw new Error('should not happen in getLastModificationForDay'); }
        }
        return cacheValue;
    }

    public async recheckAll(deltaCheckMs: number) {
        if (Date.now() < this.lastCheckTime + deltaCheckMs) {
            console.log('checkModification skipped: delta <', deltaCheckMs);
            return;
        }
        console.log('checkModification: delta >', deltaCheckMs);
        // lock to prevent multiple notifys
        this.globalNotifyLock++;
        try {
            await Promise.all(
                WEEK_DAYS.map((weekDay) => {
                    return this.checkModification(weekDay, deltaCheckMs);
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
        if (this.latestModificationDate > this.lastGlobalNotify) {
            console.log('notifyAllModification', this.latestModificationDate);
            WebsocketServer.notifyAllModification(this.latestModificationDate);
            this.lastGlobalNotify = this.latestModificationDate;
        }
    }
}

export const ModificationChecker = new ModificationCheckerClass();
