import _ from 'lodash';
import privileges from '../privileges';
import plugins from '../plugins';
import db from '../database';
import { CategoryObject } from '../types/category';

interface SearchData {
    query: string,
    page: number,
    uid: number,
    paginate: boolean,
    hardCap: number,
    resultsPerPage: number,
    qs: string
}
interface SearchResult {
    pageCount: number,
    timing: string,
    categories: CategoryObject[]
    matchCount: number
}

interface HookResult {
    cids: number[]
}

interface CategoryObjectWithChilderen extends CategoryObject {
    children: CategoryObjectWithChilderen[]
}

interface Categories {
    search(data: SearchData);
    getChildrenCids(cid: number);
    getCategories(uniqCids: number[], uid: number);
    getTree(categoryData: CategoryObject[], parentCid: number);
    getRecentTopicReplies(categoryData: CategoryObject[], uid: number, qs: string)
}

export = function (Categories: Categories) {
    async function findCids(query: string, hardCap: number) {
        if (!query || String(query).length < 2) {
            return [];
        }
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const data: string[] = await db.getSortedSetScan({
            key: 'categories:name',
            match: `*${String(query).toLowerCase()}*`,
            limit: hardCap || 500,
        }) as string[];
        return data.map(data => parseInt(data.split(':').pop(), 10));
    }

    async function getChildrenCids(cids: number[], uid: number) {
        const children: number[][] = await Promise.all(cids.map(cid => Categories.getChildrenCids(cid) as number[]));
        const result: number[] = await privileges.categories.filterCids('find', _.flatten(children), uid) as number[];
        return result;
    }

    Categories.search = async function (data: SearchData) {
        const query = data.query || '';
        const page = data.page || 1;
        const uid = data.uid || 0;
        const paginate = data.hasOwnProperty('paginate') ? data.paginate : true;

        const startTime = process.hrtime();

        let cids: number[] = await findCids(query, data.hardCap);

        const result: HookResult = await plugins.hooks.fire('filter:categories.search', {
            data: data,
            cids: cids,
            uid: uid,
        }) as HookResult;
        cids = await privileges.categories.filterCids('find', result.cids, uid) as number[];

        const searchResult: SearchResult = {
            matchCount: cids.length,
            pageCount: 0,
            timing: '',
            categories: [],
        };

        if (paginate) {
            const resultsPerPage = data.resultsPerPage || 50;
            const start = Math.max(0, page - 1) * resultsPerPage;
            const stop = start + resultsPerPage;
            searchResult.pageCount = Math.ceil(cids.length / resultsPerPage);
            cids = cids.slice(start, stop);
        }

        const childrenCids: number[] = await getChildrenCids(cids, uid);
        const uniqCids: number[] = _.uniq(cids.concat(childrenCids));
        const categoryData: CategoryObjectWithChilderen[] = await Categories.getCategories(uniqCids,
            uid) as CategoryObjectWithChilderen[];

        Categories.getTree(categoryData, 0);
        await Categories.getRecentTopicReplies(categoryData, uid, data.qs);
        categoryData.forEach((category) => {
            if (category && Array.isArray(category.children)) {
                category.children = category.children.slice(0, category.subCategoriesPerPage);
                category.children.forEach((child) => {
                    child.children = undefined;
                });
            }
        });

        categoryData.sort((c1, c2) => {
            if (c1.parentCid !== c2.parentCid) {
                return c1.parentCid - c2.parentCid;
            }
            return c1.order - c2.order;
        });

        const endTime = process.hrtime(startTime);
        const elapsedTimeInNanoSeconds = (endTime[0] * 1e9) + endTime[1];
        const elapsedTimeInSeconds = elapsedTimeInNanoSeconds / 1e9;
        searchResult.timing = elapsedTimeInSeconds.toFixed(2);
        searchResult.categories = categoryData.filter(c => cids.includes(c.cid));
        return searchResult;
    };
}
