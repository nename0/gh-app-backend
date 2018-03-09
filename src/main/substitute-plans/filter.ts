import { ParsedPlan, Substitute } from './parser';

export const ALL_FILTER = 'Alle';
const COMMON_FILTER = 'Allgemein';
const UNKNOWN_FILTER = 'Unknown';
const Q11_FILTER = 'Q11';
const Q12_FILTER = 'Q12';
const Q13_FILTER = 'Q13';
const CLASS_NUMBERS = ['5', '6', '7', '8', '9', '10'];
const CLASS_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const SELECTABLE_FILTERS = [Q11_FILTER, Q12_FILTER, Q13_FILTER];
for (const classNum of CLASS_NUMBERS) {
    for (const letter of CLASS_LETTERS) {
        SELECTABLE_FILTERS.push(classNum + letter);
    }
}

class Hasher {
    static hashNumbersCount = 2;

    numbers?: [number, number];
    index = 0;

    hashStr(str: string) {
        if (!this.numbers) {
            this.numbers = <[number, number]>Array(Hasher.hashNumbersCount).fill(0);
        }
        const numbers = this.numbers;
        str.split('').forEach((char) => {
            numbers[this.index] = ((numbers[this.index] * 31) + char.charCodeAt(0)) % Number.MAX_SAFE_INTEGER;
            this.index = (this.index + 1) % Hasher.hashNumbersCount;
        });
    }

    hashSubstitute(substitute: Substitute) {
        this.hashStr(substitute.classText);
        this.hashStr(substitute.lesson);
        this.hashStr(substitute.substitute);
        this.hashStr(substitute.teacher);
        this.hashStr(substitute.insteadOf);
        this.hashStr(substitute.room);
        this.hashStr(substitute.extra);
    }

    getHashCode(planDate: Date) {
        if (!this.numbers) {
            return undefined;
        }
        const hash = this.numbers
            .map((n) => n.toString(16).padStart(14, '0'))  // pad each to 14 chars
            .join('');
        const utcDate = new Date(planDate).setUTCHours(0, 0, 0, 0) / (24 * 3600 * 1000);
        return utcDate.toString(16).padStart(6, '0') + hash;
    }
};

export function isFilterHashFromDate(hash: string, date: Date) {
    if (hash.length !== 34) {
        throw new Error('isFilterHashFromDate: hash has wrong length: ' + hash);
    }
    const utcDate = new Date(date).setUTCHours(0, 0, 0, 0) / (24 * 3600 * 1000);
    const utcDateHash = parseInt(hash.slice(0, 6), 16);
    return utcDate === utcDateHash;
}

export class FilteredPlan {
    public filterHashes: { [filter: string]: string } = {};

    public filteredSubstitutes: { [filter: string]: Substitute[] } = {};

    constructor(
        substitutes: Substitute[], planDate: Date
    ) {
        const hasherPerFilter: { [filter: string]: Hasher } = {};
        for (const filter of SELECTABLE_FILTERS) {
            hasherPerFilter[filter] = new Hasher();
            this.filteredSubstitutes[filter] = [];
        }
        hasherPerFilter[ALL_FILTER] = new Hasher();
        this.filteredSubstitutes[ALL_FILTER] = [];
        this.filteredSubstitutes[COMMON_FILTER] = [];
        this.filteredSubstitutes[UNKNOWN_FILTER] = [];

        for (const substitute of substitutes) {
            let classText = substitute.classText;
            if (classText === 'Allgemein') {
                this.filteredSubstitutes[COMMON_FILTER].push(substitute);
                continue;
            }
            hasherPerFilter[ALL_FILTER].hashSubstitute(substitute);
            this.filteredSubstitutes[ALL_FILTER].push(substitute);
            if (classText.startsWith('IF') ||
                classText.startsWith('Ava')) {
                this.filteredSubstitutes[UNKNOWN_FILTER].push(substitute);
                continue;
            }
            if (classText.lastIndexOf('_') !== -1) {
                classText = classText.substr(0, classText.lastIndexOf('_'));
            }
            for (let classTextPart of classText.split(',')) {
                let isQClass = false;
                if (classTextPart.includes(Q11_FILTER)) {
                    isQClass = true;
                    hasherPerFilter[Q11_FILTER].hashSubstitute(substitute);
                    this.filteredSubstitutes[Q11_FILTER].push(substitute);
                }
                if (classTextPart.includes(Q12_FILTER)) {
                    isQClass = true;
                    hasherPerFilter[Q12_FILTER].hashSubstitute(substitute);
                    this.filteredSubstitutes[Q12_FILTER].push(substitute);
                }
                if (classTextPart.includes(Q13_FILTER)) {
                    isQClass = true;
                    hasherPerFilter[Q13_FILTER].hashSubstitute(substitute);
                    this.filteredSubstitutes[Q13_FILTER].push(substitute);
                }
                if (isQClass) {
                    continue;
                }
                // this will parse the number until the first letter
                const classNum = parseInt(classTextPart, 10).toString(10);
                if (classNum === 'NaN' ||
                    CLASS_NUMBERS.indexOf(classNum) === -1) {
                    this.filteredSubstitutes[UNKNOWN_FILTER].push(substitute);
                } else {
                    classTextPart = classTextPart.substr(classNum.length);
                    if (classTextPart.length === 0) {
                        CLASS_LETTERS.forEach((letter) => {
                            const filter = classNum + letter;
                            hasherPerFilter[filter].hashSubstitute(substitute);
                            this.filteredSubstitutes[filter].push(substitute);
                        });
                        continue;
                    }
                    let foundLetter = false;
                    classTextPart.split('').forEach((letter) => {
                        if (CLASS_LETTERS.indexOf(letter) >= 0) {
                            const filter = classNum + letter;
                            hasherPerFilter[filter].hashSubstitute(substitute);
                            this.filteredSubstitutes[filter].push(substitute);
                            foundLetter = true;
                        }
                    });
                    if (!foundLetter) {
                        this.filteredSubstitutes[UNKNOWN_FILTER].push(substitute);
                    }
                }
            }
        }

        for (const [filter, hasher] of Object.entries(hasherPerFilter)) {
            // include the plan date
            const hash = hasher.getHashCode(planDate);
            if (hash) {
                this.filterHashes[filter] = hash;
            } else {
                delete this.filteredSubstitutes[filter];
            }
        }
    }
}
