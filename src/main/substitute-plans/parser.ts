import * as cheerio from 'cheerio';

export function parsePlan(html: string, modified: Date): ParsedPlan {
    const $ = cheerio.load(html);
    $('head>meta').remove('[http-equiv="Content-Type"]')
    console.log($);
    return new ParsedPlan(html, modified);

}

export class ParsedPlan {
    constructor(
        public html: string,
        public modified: Date) { }
};
