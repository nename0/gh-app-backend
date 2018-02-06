import * as cheerio from 'cheerio';
import { parseDateTime } from '../db';

export function parsePlan(weekDay: string, modification: Date, html: string): ParsedPlan {
    const $ = cheerio.load(html);
    $('head>meta').remove('[http-equiv="Content-Type"]');

    return new ParsedPlan(weekDay, modification, $);
}

function parsePlanDate($: CheerioStatic) {
    const header = $('body>h2#titelVertretungen').first().text();
    ifNotParseError(header, 'headline');
    const split = header.split(',');
    ifNotParseError(split.length === 2, 'headline text');
    const split2 = split[1].trim().split('.');
    ifNotParseError(split2.length === 3, 'headline date format');
    const year = parseInt(split2[2], 10);
    const month = parseInt(split2[1], 10);
    const day = parseInt(split2[0], 10);
    ifNotParseError(year && month && day, 'headline date format');
    return new Date(Date.UTC(year, month - 1, day, 12));
}

function parseModificationDate(tables: Cheerio) {
    const header = tables.filter('[width="90%"]');
    ifNotParseError(header.length === 1, 'header');
    const text = header.find('th.TextAktuellesDatum').first().text();
    ifNotParseError(text.startsWith('Stand: '), 'header AktuellesDatum');
    ifNotParseError(text[9] === ' ', 'header AktuellesDatum');
    const dateStr = text.substring(10);

    //use postgreSQL to parse dateTime with correct time zone
    return parseDateTime(dateStr);
}

function parseMessages(tables: Cheerio) {
    const messagesHtml = tables.filter('#tabelleMitteilungen').find('td').first();
    if (!messagesHtml.length) {
        return '';
    }
    const elements = <CheerioElement[]><any>messagesHtml.contents().get();
    return elements.map((elem: CheerioElement) => {
        if (elem.type === 'tag') {
            ifNotParseError(elem.name === 'br', 'tabelleMitteilungen');
            return '\r\n';
        } else {
            ifNotParseError(elem.type === 'text', 'tabelleMitteilungen');
            return elem.data;
        }
    }).join('');
}

function parseSubstitutes(tables: Cheerio) {
    const table = tables.filter('#VP_tablevertretungen');
    ifNotParseError(table.length === 1, 'tablevertretungen');
    const rows = table.find('tr');
    const substitutes: Substitute[] = new Array(rows.length - 1);
    rows.each((i, elem) => {
        if (i === 0) {
            return;
        }
        ifNotParseError(elem.children.length === 7, 'tablevertretungen');
        substitutes[i - 1] = new Substitute(
            cheerio(elem.children[0]).text().trim(),
            cheerio(elem.children[1]).text().trim(),
            cheerio(elem.children[2]).text().trim(),
            cheerio(elem.children[3]).text().trim(),
            cheerio(elem.children[4]).text().trim(),
            cheerio(elem.children[5]).text().trim(),
            cheerio(elem.children[6]).text().trim(),
        );
    });
    return substitutes;
}

function ifNotParseError(obj: any, name: string) {
    if (!obj) {
        throw new Error('html format changed: ' + name);
    }
}

export class ParsedPlan {
    public planDate: Date;
    public outdated: boolean = false;
    public messages: string = '';
    public substitutes: Substitute[] = [];

    constructor(
        public weekDay: string,
        public modification: Date,
        $: CheerioStatic
    ) {
        this.planDate = parsePlanDate($);
        if (new Date(this.planDate).setUTCHours(23, 59, 59, 999) < Date.now()) {
            this.outdated = true;
            return;
        }

        const tables = $('body>center>table');
        parseModificationDate(tables).then((contentModification) => {
            if (+contentModification > +this.modification + 1 * 60 * 1000) {
                console.warn('modfied date in html was bigger than in http headers!! Overiding old value');
                this.modification = contentModification;
            }
        }).catch((err) => {
            console.log('Error while parsing ModificationDate in html', err.toString(), err.stack);
        });

        this.messages = parseMessages(tables);

        this.substitutes = parseSubstitutes(tables);
    }
};

export class Substitute {

    constructor(
        public classText: string,
        public lesson: string,
        public substitute: string,
        public teacher: string,
        public insteadOf: string,
        public room: string,
        public extra: string
    ) { }
}
