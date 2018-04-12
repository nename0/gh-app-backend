import { Database } from './db';
import { setVapidDetails, generateRequestDetails as WebPush_generateRequestDetails, sendNotification } from 'web-push';
import { promisify } from 'util';
import * as https from 'https';
import { Scheduler } from './scheduler';
import { SELECTABLE_FILTERS, ALL_FILTER, isFilterHashFromDate } from './substitute-plans/filter';
import { ParsedPlan } from './substitute-plans/parser';
import { ModificationChecker } from './substitute-plans/modification-checker';
import { WEEK_DAYS, getWeekDayShortStr } from './substitute-plans/gym-herz-server';

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

    public onLogout(fingerprint: string) {
        console.log('removing PushSubscription on logout for ' + fingerprint);
        Database.deletePushSubscription(fingerprint)
            .catch((err) => console.log('error in database while deleting push subscription onLogout', err.toString(), err.stack));
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
            ttlValues[plan.weekDay] = Math.floor(millisDiff / 1000);
            this.getChangesForDay(plan, pushedHashes[plan.weekDay], changedWeekDays, changedWeekDaysPerFilter);
        }
        if (!changedWeekDays.size) {
            console.log('Not Pushing');
            return;
        }
        console.log('Pushing ' + JSON.stringify(changedWeekDaysPerFilter));
        try {
            await this.sendPushNotifications(changedWeekDaysPerFilter, ttlValues, plans);
        } catch (err) {
            // reset pushedHashes
            this.pushedHashes = Database.getPushedHashes();
            throw err;
        }
        for (const weekDay of changedWeekDays) {
            Database.updatePushHashesForWeekDay(weekDay, pushedHashes[weekDay]);
        }
    }

    private getChangesForDay(planOfDay: ParsedPlan, pushedHashesOfWeekDay: { [filter: string]: string },
        changedWeekDays: Set<string>, changedWeekDaysPerFilter: { [filter: string]: string[] }) {

        const weekDay = planOfDay.weekDay;
        for (const [filter, hash] of Object.entries(planOfDay.filtered.filterHashes)) {
            if (pushedHashesOfWeekDay[filter] !== hash) {
                pushedHashesOfWeekDay[filter] = hash;
                changedWeekDays.add(weekDay);
                changedWeekDaysPerFilter[filter] = changedWeekDaysPerFilter[filter] || [];
                changedWeekDaysPerFilter[filter].push(weekDay);
            }
        }
        const removedFilters = Object.keys(pushedHashesOfWeekDay)
            .filter((filter) => !(filter in planOfDay.filtered.filterHashes));
        for (const removedFilter of removedFilters) {
            const oldHash = pushedHashesOfWeekDay[removedFilter];
            delete pushedHashesOfWeekDay[removedFilter];
            if (isFilterHashFromDate(oldHash, planOfDay.planDate)) {
                changedWeekDays.add(weekDay);
                changedWeekDaysPerFilter[removedFilter] = changedWeekDaysPerFilter[removedFilter] || [];
                changedWeekDaysPerFilter[removedFilter].push(weekDay);
            }
        }
    }

    private sendPushNotifications(changedWeekDaysPerFilter: { [filter: string]: string[] }, ttlValues: { [wd: string]: number }, plans: ParsedPlan[]) {
        const modificationHash = ModificationChecker.modificationHash;
        if (modificationHash === '') {
            throw new Error('sendPushNotifications: modificationHash not set');
        }
        let countErrors = 0;
        return Database.pushSubscriptionCursor(async (fingerprint, subscriptionValue, filterValue) => {
            const { ttlSeconds, payload } = this.generatePushPayload(filterValue, changedWeekDaysPerFilter, modificationHash, ttlValues, plans);
            if (ttlSeconds <= 0) {
                return;
            }
            try {
                const subscription = JSON.parse(subscriptionValue);
                await sendNotification(subscription, payload, {
                    // Max TTL is four weeks.
                    TTL: Math.min(ttlSeconds, 3600 * 24 * 7 * 4)
                });
            } catch (err) {
                // http code 410 (GONE) means subscription is canceled
                if (err.statusCode === 410) {
                    console.log('410 from push endpoint: removing PushSubscription for ' + fingerprint);
                    return Database.deletePushSubscription(fingerprint);
                }
                console.warn('Error from push service', err);
                countErrors++;
                if (countErrors > 4) {
                    throw err;
                }
            }
        });
    }

    private generatePushPayload(filterValue: string, changedWeekDaysPerFilter: { [filter: string]: string[] },
        modificationHash: string, ttlValues: { [wd: string]: number }, plans: ParsedPlan[]) {

        let filters: string[] = filterValue ? JSON.parse(filterValue) : [ALL_FILTER];
        filters = filters.filter((filter) => filter in changedWeekDaysPerFilter);
        if (!filters.length) {
            return { ttlSeconds: -1, payload: '' };
        }
        const weekDaysSet = new Set<string>();
        filters.forEach((filter) => changedWeekDaysPerFilter[filter]
            .forEach((wd) => weekDaysSet.add(wd)));
        const weekDays = Array.from(weekDaysSet);
        weekDays.sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b));

        const lines: string[] = [];
        let lineBeginning = '';
        outer:
        for (const wd of weekDays) {
            const plan = plans.find((p) => p.weekDay === wd);
            if (!plan) {
                throw new Error('should not happen: generatePushPayload plan for ' + wd + ' not found');
            }
            if (weekDays.length > 1) {
                lineBeginning = getWeekDayShortStr(wd) + ': ';
            }
            for (const filter of filters) {
                if (!plan.filtered.filteredSubstitutes[filter]) {
                    continue;
                }
                for (const substitute of plan.filtered.filteredSubstitutes[filter]) {
                    if (lines.length >= 8) {
                        lines.push('...');
                        break outer;
                    }
                    lines.push(lineBeginning +
                        '| ' + substitute.classText + ' | ' + substitute.lesson + ' | ' + substitute.substitute + ' |');
                    lineBeginning = '';
                }
            }
        }
        const body = lines.join('\r\n');

        const payload = JSON.stringify({
            mh: modificationHash,
            days: weekDays,
            body
        });
        const ttlSeconds = weekDays.map((wd) => ttlValues[wd]).reduce((max, ttlValue) => Math.max(max, ttlValue), 0);
        return { ttlSeconds, payload };
    }
}

export const PushMessaging = new PushMessagingClass();
