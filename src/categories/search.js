"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const lodash_1 = __importDefault(require("lodash"));
const privileges_1 = __importDefault(require("../privileges"));
const plugins_1 = __importDefault(require("../plugins"));
const database_1 = __importDefault(require("../database"));
module.exports = function (Categories) {
    function findCids(query, hardCap) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!query || String(query).length < 2) {
                return [];
            }
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const data = yield database_1.default.getSortedSetScan({
                key: 'categories:name',
                match: `*${String(query).toLowerCase()}*`,
                limit: hardCap || 500,
            });
            return data.map(data => parseInt(data.split(':').pop(), 10));
        });
    }
    function getChildrenCids(cids, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const children = yield Promise.all(cids.map(cid => Categories.getChildrenCids(cid)));
            const result = yield privileges_1.default.categories.filterCids('find', lodash_1.default.flatten(children), uid);
            return result;
        });
    }
    Categories.search = function (data) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = data.query || '';
            const page = data.page || 1;
            const uid = data.uid || 0;
            const paginate = data.hasOwnProperty('paginate') ? data.paginate : true;
            const startTime = process.hrtime();
            let cids = yield findCids(query, data.hardCap);
            const result = yield plugins_1.default.hooks.fire('filter:categories.search', {
                data: data,
                cids: cids,
                uid: uid,
            });
            cids = (yield privileges_1.default.categories.filterCids('find', result.cids, uid));
            const searchResult = {
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
            const childrenCids = yield getChildrenCids(cids, uid);
            const uniqCids = lodash_1.default.uniq(cids.concat(childrenCids));
            const categoryData = yield Categories.getCategories(uniqCids, uid);
            Categories.getTree(categoryData, 0);
            yield Categories.getRecentTopicReplies(categoryData, uid, data.qs);
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
        });
    };
};
