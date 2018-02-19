import { Database } from './db';
import { setVapidDetails, generateRequestDetails as WebPush_generateRequestDetails, sendNotification } from 'web-push';
import { promisify } from 'util';
import * as https from 'https';

const publicKey = 'BFnMFwGNZpptuw48WlgK1ae8k-t09c26C_Ssf04jmHKJfnMM26SLprWmnRr_z03MbYenDHlmsjsj_-0_T-O4U6M';
const privateKey = 'tmzN8-KqDMH-pbALgcN3mdhT2EFghJD3b6vY98Vl5N0';

https.globalAgent['keepAlive'] = true;
https.globalAgent.maxSockets = 4;

class PushMessagingClass {
    constructor() {
        setVapidDetails(
            'mailto:nename97@googlemail.com',
            publicKey,
            privateKey
        );
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
        if (!badRequest) {
            try {
                const parsed = JSON.parse(value);
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
        Database.upsertPushSubscription(fingerprint, value)
            .catch(onError);
        return true;
    }

    private validatePushSubscription(subscription: object) {
        try {
            // set payload to invalid value to skip real encryption but run validation of subscription values
            WebPush_generateRequestDetails(subscription, {});
        } catch (err) {
            return err.message === 'Payload must be either a string or a Node Buffer.'
        }
        throw new Error('expected error in validatePushSubscription');
    }

    // called by PlanFetcher
    public pushPlanModifications(weekDays: string[]) {
        const payload = JSON.stringify(weekDays);
        let countErrors = 0;
        return Database.pushSubscriptionCursor(async (fingerprint, value) => {
            try {
                const subscription = JSON.parse(value);
                await sendNotification(subscription, payload, )
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
        })
    }
}

export const PushMessaging = new PushMessagingClass();
