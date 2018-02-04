import { fetchCurrentZoneOffset } from './db';
import { setInterval, clearTimeout, setTimeout } from 'timers';
import { ModifiedChecker } from './substitute-plans/modified-checker';

// In Europe/Berlin the Daylight saving clock change is always on 1 hour utc time
const UTC_HOUR_TO_CHECK_OFFSET_CHANGE = [1, 2];

class SchedulerClass {

    lastOffsetCheckUTCHour = new Date(0);
    // Offset in Europe/Berlin
    currentZoneOffset: Promise<number>;
    timeoutForModificationCheck = -1;
    timerForModificationCheck!: NodeJS.Timer;

    constructor() {
        this.currentZoneOffset = new Promise(() => { });
        this.checkZoneOffset();
    }

    checkZoneOffset = () => {
        if (new Date(this.lastOffsetCheckUTCHour).setUTCHours(0, 0, 0, 0) === new Date().setUTCHours(0, 0, 0, 0)) {
            // Already checked today
            const utcHour = new Date().getUTCHours();
            if (utcHour <= this.lastOffsetCheckUTCHour.getUTCHours() ||
                !UTC_HOUR_TO_CHECK_OFFSET_CHANGE.includes(utcHour)) {
                return;
            }
        }
        this.currentZoneOffset = fetchCurrentZoneOffset()
            .then((result) => {
                this.lastOffsetCheckUTCHour = new Date();
                this.scheduleModificationCheck();
                return result;
            })
            .catch((err) => {
                console.log('Error while fetchCurrentZoneOffset', err.toString(), err.stack);
                return -60; // wild guess
            });
    }

    async getLocalDateTime() {
        const toZoneOffset = -(await this.currentZoneOffset);
        const now = new Date();
        const diffOffset = toZoneOffset + now.getTimezoneOffset();
        now.setMinutes(now.getMinutes() + diffOffset);
        return now;
    }

    async isBurstTime() {
        const localDateTime = (await this.getLocalDateTime());
        const localHour = localDateTime.getHours();
        const localMinute = localDateTime.getMinutes();
        switch (localHour) {
            case 7:
                return localMinute > 30;
            case 8:
                return localMinute < 30;
            case 12:
                return localMinute > 30;
            case 13:
                return localMinute < 30;
        }
        return false;
    }

    private async scheduleModificationCheck() {
        if (this.timerForModificationCheck) {
            clearTimeout(this.timerForModificationCheck);
        }
        const timeout = (await this.isBurstTime()) ? 10 * 1000 : 4 * 60 * 1000;
        if (this.timeoutForModificationCheck !== timeout) {
            console.log('Changing timeout for ModificationCheck to', timeout);
            this.timeoutForModificationCheck = timeout;
        }
        this.timerForModificationCheck = setTimeout(this.checkModification, this.timeoutForModificationCheck);
    }

    private checkModification = async () => {
        await ModifiedChecker.recheckAll(this.timeoutForModificationCheck)
            .catch((err) => {
                console.log('Error in scheduled checkModification', err.toString(), err.stack);
            });
        this.scheduleModificationCheck();
    }

    public async start() {
        setInterval(this.checkZoneOffset, 15 * 60 * 1000);
        setImmediate(this.checkModification);
    }
}

export const Scheduler = new SchedulerClass();
