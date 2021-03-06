import * as express from 'express';
import { PlanFetcher } from './plan-fetcher';
import { WEEK_DAYS } from './gym-herz-server';
import { ModificationChecker } from './modification-checker';

const API_CACHE_CONTROL = 'public, max-age=4, stale-while-revalidate=5';

export function plansApi(app: express.IRouter<any>) {
    app.get('/plans/getModificationHash', async function(req, res) {
        const date = await ModificationChecker.getLatestModification();
        const hash = ModificationChecker.modificationHash;
        if (hash === '') {
            throw new Error('api getModificationHash: modificationHash not set after getLatestModification()');
        }
        res.set({
            'cache-control': API_CACHE_CONTROL,
            'last-modified': date.toUTCString(),
            'etag': hash
        });
        res.status(204).send();
    });

    app.get('/plans/plan', async function(req, res) {
        const weekDay = req.query.wd;
        if (!weekDay || WEEK_DAYS.indexOf(weekDay) === -1) {
            res.status(400).send('Missing wd query param');
            return;
        }

        const plan = await PlanFetcher.getPlan(weekDay);
        res.set({
            'cache-control': API_CACHE_CONTROL,
            'last-modified': plan.modification.toUTCString()
        });
        res.json(plan);
    });
};
