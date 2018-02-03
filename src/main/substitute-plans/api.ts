import * as express from 'express';
import { ModifiedChecker } from './modified-checker';
import { PlanFetcher } from './plan-fetcher';
import { WEEK_DAYS } from './gym-herz-server';

const API_CACHE_CONTROL = 'public, max-age=10, stale-while-revalidate=180';

export function plansApi(app: express.IRouter<any>) {
    app.get('/plans/getLatest', async function(req, res) {
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
        if (!plan) {
            res.status(500).send('unable to fetch plan');
            return;
        }
        res.set({
            'cache-control': API_CACHE_CONTROL,
            'last-modified': plan.modified.toUTCString(),
            'content-type': 'text/html'
        });
        res.send(plan.html);
    });
};
