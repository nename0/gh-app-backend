import { setInterval, clearTimeout, setTimeout } from 'timers';
import { ModificationChecker } from './substitute-plans/modification-checker';
import { Database } from './db';
import { PushMessaging } from './push';

// In Europe/Berlin the Daylight saving clock change is always on 1 hour utc time
const UTC_HOUR_TO_CHECK_OFFSET_CHANGE = [1, 2];

class SchedulerClass {

    lastOffsetCheckUTCHour = new Date(0);
    // Offset in Europe/Berlin
    currentZoneOffset: Promise<number>;
    timeoutForModificationCheck = -1;
    timerForModificationCheck!: NodeJS.Timer;

    constructor() {
        this.currentZoneOffset = Promise.resolve(-60); // wild guess should never be used
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
        this.currentZoneOffset = Database.fetchCurrentZoneOffset()
            .then((result) => {
                this.lastOffsetCheckUTCHour = new Date();
                this.scheduleModificationCheck();
                console.log('zone offset: ' + result);
                return result;
            })
            .catch((err) => {
                console.log('Error while fetchCurrentZoneOffset', err.toString(), err.stack);
                return -60; // wild guess
            });
    }

    public async getLocalDateTime() {
        const toZoneOffset = -(await this.currentZoneOffset);
        const now = new Date();
        const diffOffset = toZoneOffset + now.getTimezoneOffset();
        now.setMinutes(now.getMinutes() + diffOffset);
        return now;
    }

    async getModificationCheckTimeout() {
        const localDateTime = (await this.getLocalDateTime());
        // Sunday (0) to Saturday (6)
        if (localDateTime.getDay() === 0 || localDateTime.getDay() === 6) {
            return 15 * 60 * 1000;
        }
        const localHour = localDateTime.getHours();
        const localMinute = localDateTime.getMinutes();
        let isBurstTime = false;
        switch (localHour) {
            case 7:
                isBurstTime = localMinute > 30;
                break;
            case 8:
                isBurstTime = localMinute < 30;
                break;
            case 12:
                isBurstTime = localMinute > 30;
                break;
            case 13:
                isBurstTime = localMinute < 30;
        }
        return isBurstTime ? 10 * 1000 : 4 * 60 * 1000;
    }

    private async scheduleModificationCheck() {
        const timeout = await this.getModificationCheckTimeout();
        if (this.timeoutForModificationCheck !== timeout) {
            console.log('Changing timeout for ModificationCheck to', timeout);
            this.timeoutForModificationCheck = timeout;
        }
        if (this.timerForModificationCheck) {
            clearTimeout(this.timerForModificationCheck);
        }
        this.timerForModificationCheck = setTimeout(this.checkModification, this.timeoutForModificationCheck);
    }

    private checkModification = async () => {
        await ModificationChecker.recheckAll(this.timeoutForModificationCheck)
            .catch((err) => {
                console.log('Error in scheduled checkModification', err.toString(), err.stack);
            });
        this.scheduleModificationCheck();
    }

    public async start() {
        await this.currentZoneOffset;
        setInterval(this.checkZoneOffset, 15 * 60 * 1000);
        await this.checkModification();
        setInterval(PushMessaging.deleteOldSubscriptions, 24 * 3600 * 1000);
        setTimeout(PushMessaging.deleteOldSubscriptions, 5 * 1000);
    }
}

export const Scheduler = new SchedulerClass();
