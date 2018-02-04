import { Client, Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true,

    max: 3
});

pool.on('connect', (client) => {
    client.query('SET TIME ZONE "Europe/Berlin"');
})

//exapmle str 01.02.2018 07:42
export async function parseDateTime(str: string): Promise<Date> {
    const query = {
        name: 'parse-date-time',
        text: 'select extract(epoch from to_timestamp($1, \'DD.MM.YYYY HH24:MI\') at time zone \'UTC\') * 1000',
        values: [str],
        rowMode: 'array'
    }

    const result = await pool.query(query);
    return new Date(result.rows[0][0]);
}

export async function fetchCurrentZoneOffset(): Promise<number> {
    const query = {
        name: 'now-json',
        text: 'select to_json(now())',
        rowMode: 'array'
    }

    const result = await pool.query(query);
    const zoneOffsetString = result.rows[0][0].slice(-6);
    const hour = parseInt(zoneOffsetString.slice(1, 3), 10);
    const minute = parseInt(zoneOffsetString.slice(4, 6), 10);
    if (zoneOffsetString[3] !== ':' || isNaN(hour) || isNaN(minute)) {
        throw new Error('invalid date format from postgresql');
    }
    // inverse because offset is from localTime to utc (in Europe/Berlin -60 and -120)
    const sign = zoneOffsetString[0] === '+' ? -1 : 1;
    return sign * (hour * 60 + minute);
}
