import * as express from 'express';
import { PlanFetcher } from './plan-fetcher';
import { WEEK_DAYS } from './gym-herz-server';
import { ModificationChecker } from './modification-checker';

const API_CACHE_CONTROL = 'public, max-age=10, stale-while-revalidate=180';

export function plansApi(app: express.IRouter<any>) {
    app.get('/plans/getLatestModification', async function(req, res) {
        const date = await ModificationChecker.getLatestModification();
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
            'last-modified': plan.modification.toUTCString()
        });
        res.json(plan);
    });
};
