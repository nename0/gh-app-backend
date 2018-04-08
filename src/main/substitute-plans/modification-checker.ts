import { IncomingMessage } from 'http';
import { ParsedPlan } from './parser';
import { PlanFetcher } from './plan-fetcher';
import { WEEK_DAYS, REQUEST_RETRY_TIME, onRequestSocketTimeout, getGymHerzRequest } from './gym-herz-server';
import { WebsocketServer } from '../websocket';

class ModificationCheckerClass {
    private modificationsCache: { [wd: string]: Date | undefined } = {};
    private latestModificationDate = new Date(-1);
    private lastCheckTime = 0;
    public isChecking = false;
    private recheckAllPromise?: Promise<void>;
    public modificationHash: string = '';

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
        const message: IncomingMessage = await getGymHerzRequest().head(options);
        const lastModified = message.headers['last-modified'];
        if (message.statusCode === 200 && lastModified) {
            return new Date(lastModified);
        } else if (message.statusCode === 304) {
            return (<Date>oldValue);
        }
        console.log('Bad response from www.gymnasium-herzogenaurach.de', message.statusCode, message.headers);
        throw new Error('Bad response from www.gymnasium-herzogenaurach.de: ' + message.statusCode);
    }

    private checkModification(weekDay: string, deltaCheckMs: number) {
        const cacheValue = this.modificationsCache[weekDay];
        return this.checkModificationRequest(weekDay, cacheValue)
            .then((result) => {
                if (result === cacheValue) {
                    return cacheValue;
                }
                PlanFetcher.notifyPlanModification(weekDay, result);
                return result;
            })
            .catch((err) => {
                if (err.toString().includes('ESOCKETTIMEDOUT')) {
                    onRequestSocketTimeout();
                }
                this.modificationsCache[weekDay] = undefined;
                this.modificationHash = '';
                throw err;
            });
    }

    // called by api endpoint
    public async getLatestModification() {
        await this.recheckAll(45000);
        return this.latestModificationDate;
    }

    // called when plan is fetched by api endpoint
    public async getLastModificationForDay(weekDay: string) {
        let cacheValue = this.modificationsCache[weekDay];
        if (!cacheValue) {
            await this.recheckAll(45000);
            cacheValue = this.modificationsCache[weekDay]
            if (!cacheValue) { throw new Error('should not happen in getLastModificationForDay'); }
        }
        return cacheValue;
    }

    public async recheckAll(deltaCheckMs: number) {
        const lastCheckTime = this.lastCheckTime;
        if (this.isChecking || Date.now() < lastCheckTime + deltaCheckMs) {
            console.log('recheckAllModification  skipped: delta <', deltaCheckMs);
            return this.recheckAllPromise;
        }
        console.log('recheckAllModification: delta >', deltaCheckMs);
        try {
            this.lastCheckTime = Date.now();
            this.isChecking = true;
            this.recheckAllPromise = this.doRecheckAll(deltaCheckMs);
            await this.recheckAllPromise;
        } catch (err) {
            // reset lastCheckTime
            this.lastCheckTime = Date.now() - deltaCheckMs + REQUEST_RETRY_TIME;
            throw err;
        } finally {
            this.isChecking = false;
            PlanFetcher.tryNotifyGlobal();
        }
    }

    private async doRecheckAll(deltaCheckMs: number) {
        const dates = await Promise.all(
            WEEK_DAYS.map((weekDay) => {
                return this.checkModification(weekDay, deltaCheckMs);
            })
        );
        if (this.updateModificationHashIfChanged(dates)) {
            console.log('notifyModificationHash ' + this.latestModificationDate.toUTCString());
            WebsocketServer.notifyModificationHash(this.modificationHash);
        }
    }

    private updateModificationHashIfChanged(dates: Date[]): boolean {
        if (dates.length !== WEEK_DAYS.length) {
            throw new Error('updateModificationHashIfChanged: array length mismatch');
        }
        // the modification dates only have second resolution
        const utcSeconds = dates.map((date) => date.getTime() / 1000);
        const hashNumbersCount = 2;
        const iterationsCount = 4;
        const hashNumbers: number[] = Array(hashNumbersCount).fill(0);
        let resultIndex = 0;
        for (let i = 0; i < iterationsCount; i++) {
            for (const secondsValue of utcSeconds) {
                // tslint:disable-next-line:no-bitwise
                const value = secondsValue >>> i * 6;
                hashNumbers[resultIndex] = (hashNumbers[resultIndex] * 31 + value) % Number.MAX_SAFE_INTEGER;
                resultIndex = (resultIndex + 1) % hashNumbersCount;
            }
        }
        const hash = hashNumbers
            .map((n) => n.toString(16).padStart(14, '0'))  // pad each to 14 chars
            .join('');
        if (this.modificationHash !== hash) {
            this.modificationHash = hash;
            this.latestModificationDate = dates.reduce((maximum, date) =>
                maximum < date ? date : maximum,
                new Date(-1));
            WEEK_DAYS.forEach((wd, index) => this.modificationsCache[wd] = dates[index]);
            return true;
        }
        return false;
    }
}

export const ModificationChecker = new ModificationCheckerClass();
