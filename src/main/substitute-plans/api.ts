import * as express from 'express';
import { ModifiedChecker } from './modified-checker';
import { PlanFetcher } from './plan-fetcher';
import { WEEK_DAYS } from './gym-herz-server';

const API_CACHE_CONTROL = 'public, max-age=10, stale-while-revalidate=180';

export function plansApi(app: express.IRouter<any>) {
    app.get('/plans/getLatestModified', async function(req, res) {
        const date = await ModifiedChecker.getLatestModified();
        res.set({
            'cache-control': API_CACHE_CONTROL,
            'last-modified': date.toUTCString()
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
            'last-modified': plan.modified.toUTCString()
        });
        res.json(plan);
    });
};
