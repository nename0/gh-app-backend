import { Database } from './db';
import { setVapidDetails, generateRequestDetails as WebPush_generateRequestDetails, sendNotification } from 'web-push';
import { promisify } from 'util';
import * as https from 'https';
import { Scheduler } from './scheduler';
import { SELECTABLE_FILTERS, ALL_FILTER, isFilterHashFromDate } from './substitute-plans/filter';
import { ParsedPlan } from './substitute-plans/parser';
import { ModificationChecker } from './substitute-plans/modification-checker';

const publicKey = 'BFnMFwGNZpptuw48WlgK1ae8k-t09c26C_Ssf04jmHKJfnMM26SLprWmnRr_z03MbYenDHlmsjsj_-0_T-O4U6M';
const privateKey = 'tmzN8-KqDMH-pbALgcN3mdhT2EFghJD3b6vY98Vl5N0';

https.globalAgent['keepAlive'] = true;
https.globalAgent.maxSockets = 4;

class PushMessagingClass {
    private pushedHashes: Promise<{ [wd: string]: { [filter: string]: string } }>;

    constructor() {
        setVapidDetails(
            'mailto:nename97@googlemail.com',
            publicKey,
            privateKey
        );
        this.pushedHashes = Database.getPushedHashes();
    }

    public deleteOldSubscriptions = async () => {
        const result = await Database.deleteOldPushSubscriptions()
            .catch((err) => {
                console.log('error in deleteOldPushSubscriptions', err.toString(), err.stack);
                return -1;
            });
        console.log('Deleted ' + result + ' old push subscriptions');
    }

    public onWebsocketMessage(fingerprint: string, value: string) {
        const onError = (err) => {
            console.log('error in database while updating push subscription', err.toString(), err.stack);
        };
        let badRequest = value.length > 1024;
        let isNull = false;
        let parsed;
        if (!badRequest) {
            try {
                parsed = JSON.parse(value);
                isNull = !parsed;
                if (!isNull) {
                    badRequest = !this.validatePushSubscription(parsed);
                }
            } catch (ignore) {
                badRequest = true;
            }
        }
        if (badRequest || isNull) {
            console.log('removing PushSubscription for ' + fingerprint);
            Database.deletePushSubscription(fingerprint)
                .catch(onError);
            return !badRequest;
        }
        console.log('updating PushSubscription for ' + fingerprint);
        delete parsed['expirationTime'];
        let filters = parsed.filter;
        delete parsed.filter;
        value = JSON.stringify(parsed);
        filters = Array.isArray(filters) ? filters : [];
        filters = filters.filter((filter) => SELECTABLE_FILTERS.includes(filter));
        filters = filters.length ? JSON.stringify(filters) : null;
        Database.upsertPushSubscription(fingerprint, value, filters)
            .catch(onError);
        return true;
    }

    private validatePushSubscription(subscription: object) {
        try {
            // set payload to invalid value to skip real encryption but run validation of subscription values
            WebPush_generateRequestDetails(subscription, {});
        } catch (err) {
            return err.message === 'Payload must be either a string or a Node Buffer.';
        }
        throw new Error('expected error in validatePushSubscription');
    }

    // called by PlanFetcher
    public async notifyPlanModifications(plans: ParsedPlan[]) {
        const localDateTime = await Scheduler.getLocalDateTime();
        const pushedHashes = await this.pushedHashes;
        const changedWeekDays: Set<string> = new Set();
        const changedWeekDaysPerFilter: { [filter: string]: string[] } = {};
        const ttlValues: { [wd: string]: number } = {};
        for (const plan of plans) {
            const date = new Date(plan.planDate);
            date.setHours(17, 0, 0, 0);
            const millisDiff = date.getTime() - localDateTime.getTime();
            if (millisDiff < 0) {
                continue; // only push when 17 o'clock of the plan's date is still in the future
            }
            const weekDay = plan.weekDay;
            ttlValues[weekDay] = Math.floor(millisDiff / 1000);
            const pushedHashesOfWeekDay = pushedHashes[weekDay];
            for (const [filter, hash] of Object.entries(plan.filtered.filterHashes)) {
                if (pushedHashesOfWeekDay[filter] !== hash) {
                    pushedHashesOfWeekDay[filter] = hash;
                    changedWeekDays.add(weekDay);
                    changedWeekDaysPerFilter[filter] = changedWeekDaysPerFilter[filter] || [];
                    changedWeekDaysPerFilter[filter].push(weekDay);
                }
            }
            const removedFilters = Object.keys(pushedHashesOfWeekDay)
                .filter((filter) => !(filter in plan.filtered.filterHashes));
            for (const removedFilter of removedFilters) {
                const oldHash = pushedHashesOfWeekDay[removedFilter];
                delete pushedHashesOfWeekDay[removedFilter];
                if (isFilterHashFromDate(oldHash, plan.planDate)) {
                    changedWeekDays.add(weekDay);
                    changedWeekDaysPerFilter[removedFilter] = changedWeekDaysPerFilter[removedFilter] || [];
                    changedWeekDaysPerFilter[removedFilter].push(weekDay);
                }
            }
        }
        if (!changedWeekDays.size) {
            console.log('Not Pushing');
            return;
        }
        console.log('Pushing ' + JSON.stringify(changedWeekDaysPerFilter));
        try {
            await this.sendPushNotifications(changedWeekDaysPerFilter, ttlValues);
        } catch (err) {
            // reset pushedHashes
            this.pushedHashes = Database.getPushedHashes();
            throw err;
        }
        for (const weekDay of changedWeekDays) {
            Database.updatePushHashesForWeekDay(weekDay, pushedHashes[weekDay]);
        }
    }

    private sendPushNotifications(changedWeekDaysPerFilter: { [filter: string]: string[]; }, ttlValues: { [wd: string]: number; }) {
        const modificationHash = ModificationChecker.modificationHash;
        let countErrors = 0;
        return Database.pushSubscriptionCursor(async (fingerprint, subscriptionValue, filterValue) => {
            let filters: string[] = filterValue ? JSON.parse(filterValue) : [ALL_FILTER];
            filters = filters.filter((filter) => filter in changedWeekDaysPerFilter);
            if (!filters.length) {
                return;
            }
            const weekDaysSet = new Set();
            filters.forEach((filter) => changedWeekDaysPerFilter[filter]
                .forEach((wd) => weekDaysSet.add(wd)));
            const weekDays = Array.from(weekDaysSet);
            const payload = JSON.stringify({
                mh: modificationHash,
                days: weekDays
            });
            let ttl = weekDays.map((wd) => ttlValues[wd]).reduce((max, ttlValue) => Math.max(max, ttlValue), 0);
            // Max TTL is four weeks.
            ttl = Math.min(ttl, 3600 * 24 * 7 * 4);
            try {
                const subscription = JSON.parse(subscriptionValue);
                await sendNotification(subscription, payload, {
                    TTL: ttl
                });
            } catch (err) {
                // http code 410 (GONE) means subscription is canceled
                if (err.statusCode === 410) {
                    console.log('410 from push endpoint: removing PushSubscription for ' + fingerprint);
                    return Database.deletePushSubscription(fingerprint);
                }
                countErrors++;
                if (countErrors > 4) {
                    throw err;
                }
            }
        });
    }
}

export const PushMessaging = new PushMessagingClass();
