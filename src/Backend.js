import find from 'lodash/collection/find';
import sortByOrder from 'lodash/collection/sortByOrder';
import omit from 'lodash/object/omit';
import {ListIterator, objectDiff} from './utils';

/**
 * Handles the underlying data structure for a {@link Model} class.
 */
const Backend = class Backend {
    /**
     * Creates a new {@link Backend} instance.
     * @param  {Object} userOpts - options to use.
     */
    constructor(userOpts) {
        const defaultOpts = {
            idAttribute: 'id',
            indexById: true,
            ordered: true,
            arrName: 'items',
            mapName: 'itemsById',
            withMutations: false,
        };

        Object.assign(this, defaultOpts, userOpts);
    }

    /**
     * Returns a reference to the object at index `id`
     * in state `branch`.
     *
     * @param  {Object} branch - the state
     * @param  {Number} id - the id of the object to get
     * @return {Object} A reference to the raw object in the state.
     */
    accessId(branch, id) {
        if (this.indexById) {
            return branch[this.mapName][id];
        }

        return find(branch[this.arrName], {[this.idAttribute]: id});
    }

    accessIdList(branch) {
        return branch[this.arrName];
    }

    /**
     * Returns a {@link ListIterator} instance for
     * the list of objects in `branch`.
     *
     * @param  {Object} branch - the model's state branch
     * @return {ListIterator} An iterator that loops through the objects in `branch`
     */
    iterator(branch) {
        if (this.indexById) {
            return new ListIterator(branch[this.arrName], 0, (list, idx) => branch[this.mapName][list[idx]]);
        }

        return new ListIterator(branch[this.arrName], 0);
    }

    accessList(branch) {
        return branch[this.arrName].map(id => {
            const obj = this.accessId(branch, id);
            return Object.assign({[this.idAttribute]: id}, obj);
        });
    }

    /**
     * Returns the default state for the data structure.
     * @return {Object} The default state for this {@link Backend} instance's data structure
     */
    getDefaultState() {
        if (this.indexById) {
            return {
                [this.arrName]: [],
                [this.mapName]: {},
            };
        }

        return {
            [this.arrName]: [],
        };
    }

    /**
     * Returns the data structure with objects in ascending order.
     * This function uses the `lodash `[sortByOrder](https://lodash.com/docs#sortByOrder)
     * internally, so you can supply it the same `iteratees` and `orders`
     * arguments. Please read there for the full docs.
     *
     * @param  {Object} branch - the state of the data structure
     * @param  {Function[]|Object[]|string[]} iteratees - the iteratees to sort by
     * @param  {string[]} orders - the sort orders of `iteratees`
     * @return {Object} the data structure ordered with the arguments.
     */
    order(branch, iteratees, orders) {
        const returnBranch = this.withMutations ? branch : {};
        const thisBackend = this;
        const {arrName, mapName} = this;

        if (this.indexById) {
            if (!this.withMutations) {
                returnBranch[mapName] = branch[mapName];
            }

            // TODO: we don't need to build a full list to sort,
            // but it's convenient for direct use of lodash.
            // By implementing our own sorting, this could be more performant.
            const fullList = this.accessList(branch);
            const orderedObjects = sortByOrder(fullList, iteratees, orders);

            returnBranch[arrName] = orderedObjects.map(obj => obj[thisBackend.idAttribute]);
            return returnBranch;
        }

        returnBranch[arrName] = sortByOrder(branch[arrName], iteratees, orders);
        return returnBranch;
    }

    /**
     * Returns the data structure including a new object `entry`
     * @param  {Object} branch - the data structure state
     * @param  {Object} entry - the object to insert
     * @return {Object} the data structure including `entry`.
     */
    insert(branch, entry) {
        if (this.indexById) {
            const id = entry[this.idAttribute];

            if (this.withMutations) {
                branch[this.arrName].push(id);
                branch[this.mapName][id] = entry;
                return branch;
            }

            return {
                [this.arrName]: branch[this.arrName].concat(id),
                [this.mapName]: Object.assign({}, branch[this.mapName], {[id]: entry}),
            };
        }

        if (this.withMutations) {
            branch[this.arrName].push(entry);
            return branch;
        }

        return {
            [this.arrName]: branch[this.arrName].concat(entry),
        };
    }

    /**
     * Returns the data structure with objects where id in `idArr`
     * are:
     *
     * 1. merged with `patcher`, if `patcher` is an object.
     * 2. mapped with `patcher`, if `patcher` is a function.
     *
     * @param  {Object} branch - the data structure state
     * @param  {Array} idArr - the id's of the objects to update
     * @param  {Object|Function} patcher - If an object, the object to merge with objects
     *                                     where their id is in `idArr`. If a function,
     *                                     the mapping function for the objects in the
     *                                     data structure.
     * @return {Object} the data structure with objects with their id in `idArr` updated with `patcher`.
     */
    update(branch, idArr, patcher) {
        const returnBranch = this.withMutations ? branch : {};

        const {
            arrName,
            mapName,
            idAttribute,
        } = this;

        let mapFunction;
        if (typeof patcher === 'function') {
            mapFunction = patcher;
        } else {
            mapFunction = (entity) => {
                const diff = objectDiff(entity, patcher);
                if (diff) {
                    return Object.assign({}, entity, patcher);
                }
                return entity;
            };
        }

        if (this.indexById) {
            if (!this.withMutations) {
                returnBranch[mapName] = Object.assign({}, branch[mapName]);
                returnBranch[arrName] = branch[arrName];
            }

            const updatedMap = {};
            idArr.reduce((map, id) => {
                const result = mapFunction(branch[mapName][id]);
                if (result !== branch[mapName][id]) map[id] = result;
                return map;
            }, updatedMap);

            const diff = objectDiff(returnBranch[mapName], updatedMap);
            if (diff) {
                Object.assign(returnBranch[mapName], diff);
            } else {
                return branch;
            }
            return returnBranch;
        }

        let updated = false;
        returnBranch[arrName] = branch[arrName].map(entity => {
            if (idArr.includes(entity[idAttribute])) {
                const result = mapFunction(entity);
                if (entity !== result) {
                    updated = true;
                }
                return mapFunction(entity);
            }
            return entity;
        });
        return updated ? returnBranch : branch;
    }

    /**
     * Returns the data structure without objects with their id included in `idsToDelete`.
     * @param  {Object} branch - the data structure state
     * @param  {Array} idsToDelete - the ids to delete from the data structure
     * @return {Object} the data structure without ids in `idsToDelete`.
     */
    delete(branch, idsToDelete) {
        const {arrName, mapName, idAttribute} = this;
        const arr = branch[arrName];

        if (this.indexById) {
            if (this.withMutations) {
                idsToDelete.forEach(id => {
                    const idx = arr.indexOf(id);
                    if (idx !== -1) {
                        arr.splice(idx, 1);
                    }
                    delete branch[mapName][id];
                });
                return branch;
            }
            return {
                [arrName]: branch[arrName].filter(id => !idsToDelete.includes(id)),
                [mapName]: omit(branch[mapName], idsToDelete),
            };
        }

        if (this.withMutations) {
            idsToDelete.forEach(id => {
                const idx = arr.indexOf(id);
                if (idx === -1) {
                    arr.splice(idx, 1);
                }
            });
            return branch;
        }

        return {
            [arrName]: arr.filter(entity => !idsToDelete.includes(entity[idAttribute])),
        };
    }
};

export default Backend;
