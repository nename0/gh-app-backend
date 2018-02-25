import { Client, Pool } from 'pg';
import { EXPIRE_PERIOD_WEEKS } from './auth';
import * as Cursor from 'pg-cursor';
import { promisify } from 'util';
import { WEEK_DAYS } from './substitute-plans/gym-herz-server';

//`CREATE TABLE push_subscription (
//   browser_fingerprint     char(56)  PRIMARY KEY NOT NULL,
//   subscription    text UNIQUE NOT NULL,
//   update_time timestamptz NOT NULL,
//   filter text);`

//`CREATE OR REPLACE FUNCTION upsert_push_subscription(fingerprint char(56), newSubscription text, newFilter text) RETURNS INTEGER AS $$
// DECLARE
//   now TIMESTAMPTZ := now();
// BEGIN
//   LOOP
//         PERFORM push_subscription.browser_fingerprint from push_subscription where
//             ( push_subscription.browser_fingerprint = fingerprint AND push_subscription.update_time >= now ) OR
//             ( push_subscription.subscription = newSubscription AND push_subscription.update_time >= now );
//         IF  FOUND  THEN
//             RETURN -1;
//         END IF;
//
//         BEGIN
//             INSERT INTO push_subscription VALUES (fingerprint, newSubscription, now, newFilter)
//                 ON CONFLICT (browser_fingerprint) DO UPDATE SET subscription = newSubscription, update_time = now, filter = newFilter;
//             RETURN 0;
//         EXCEPTION WHEN unique_violation THEN
//         BEGIN
//                 INSERT INTO push_subscription VALUES (fingerprint, newSubscription, now, newFilter)
//                     ON CONFLICT (subscription) DO UPDATE SET browser_fingerprint = fingerprint, update_time = now, filter = newFilter;
//                 RETURN 1;
//             EXCEPTION WHEN unique_violation THEN
//                 -- Do nothing, and loop to try the UPDATE again.
//             END;
//         END;
//     END LOOP;
// END;
// $$ LANGUAGE PLPGSQL;`

//`CREATE TABLE pushed_hashes (
//    weekday     char(2)  PRIMARY KEY NOT NULL,
//    value       text NOT NULL);`

Cursor.prototype.readAsync = promisify(Cursor.prototype.read);
Cursor.prototype.closeAsync = promisify(Cursor.prototype.close);

class DatabaseClass {
    private readonly pool: Pool;

    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: true,

            max: 3
        });
        this.pool.on('connect', (client) => {
            client.query('SET TIME ZONE "Europe/Berlin"');
        });

        //this.pool.query(`DELETE FROM pushed_hashes`)
        //    .then(console.log, console.log)
        //    .then(() => {
        //        pool.query(`SELECT * FROM push_subscription`)
        //            .then(console.log, console.log);
        //    });
    }

    // example str: 01.02.2018 07:42
    public async parseDateTime(str: string): Promise<Date> {
        const query = {
            name: 'parse-date-time',
            text: 'select extract(epoch from to_timestamp($1, \'DD.MM.YYYY HH24:MI\') at time zone \'UTC\') * 1000',
            values: [str],
            rowMode: 'array'
        }

        const result = await this.pool.query(query);
        return new Date(result.rows[0][0]);
    }

    public async fetchCurrentZoneOffset(): Promise<number> {
        const query = {
            name: 'now-json',
            text: 'select to_json(now())',
            rowMode: 'array'
        }

        const result = await this.pool.query(query);
        const zoneOffsetString = result.rows[0][0].slice(-6);
        const hour = parseInt(zoneOffsetString.slice(1, 3), 10);
        const minute = parseInt(zoneOffsetString.slice(4, 6), 10);
        if (zoneOffsetString[3] !== ':' || isNaN(hour) || isNaN(minute)) {
            throw new Error('invalid date format from postgresql');
        }
        // inverse because Date.getTimezoneOffset() is from localTime to utc (e.g. in Europe/Berlin -60 or -120)
        const sign = zoneOffsetString[0] === '+' ? -1 : 1;
        return sign * (hour * 60 + minute);
    }

    public async getPushedHashes(): Promise<{ [wd: string]: { [filter: string]: string } }> {
        const query = {
            text: 'select * from pushed_hashes',
            rowMode: 'array'
        }
        const result = await this.pool.query(query);
        const map: { [wd: string]: { [filter: string]: string } } =
            result.rows.reduce((newMap, row) => {
                newMap[row[0]] = JSON.parse(row[1]);
                return newMap;
            }, {});
        for (const wd of WEEK_DAYS) {
            if (!(wd in map)) {
                map[wd] = {};
            }
        }
        return map;
    }
    public async updatePushHashesForWeekDay(weekDay: string, value: { [filter: string]: string }) {
        const query = {
            name: 'update-pushed-hashes',
            text: 'INSERT INTO pushed_hashes VALUES ($1, $2) ON CONFLICT (weekday) DO UPDATE SET value = $2',
            values: [weekDay, JSON.stringify(value)]
        }
        await this.pool.query(query);
    }

    public async upsertPushSubscription(fingerprint: string, value: string, filter: string) {
        const query = {
            name: 'upsert-push-subscription',
            text: 'select upsert_push_subscription($1, $2, $3)',
            values: [fingerprint, value, filter]
        }
        await this.pool.query(query);
    }

    public async deletePushSubscription(fingerprint: string) {
        const query = {
            name: 'delete-push-subscription',
            text: 'delete from push_subscription where push_subscription.browser_fingerprint = $1',
            values: [fingerprint]
        }
        await this.pool.query(query);
    }

    public async deleteOldPushSubscriptions() {
        const query = {
            name: 'delete-old-push-subscriptions',
            text: 'delete from push_subscription where push_subscription.update_time < now() - interval \'' + EXPIRE_PERIOD_WEEKS + ' weeks\''
        }
        const result = await this.pool.query(query);
        return result.rowCount;
    }

    public async pushSubscriptionCursor(
        foreach: (fingerprint: string, value: string, filter: string) => Promise<void>
    ) {
        const cursor = new Cursor(
            'select push_subscription.browser_fingerprint, push_subscription.subscription, push_subscription.filter from push_subscription',
            [],
            { rowMode: 'array' }
        );
        const client = await this.pool.connect();
        try {
            client.query(cursor);
            while (true) {
                const rows: string[][] = await cursor.readAsync(4);
                if (rows.length === 0) {
                    break;
                }
                await Promise.all(rows.map((row) =>
                    foreach(row[0], row[1], row[2])
                ));
            }
            await cursor.closeAsync();
        } finally {
            client.release();
        }
    }
}

export const Database = new DatabaseClass();
