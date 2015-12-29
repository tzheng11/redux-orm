import forOwn from 'lodash/object/forOwn';
import isArray from 'lodash/lang/isArray';

import Session from './Session';
import Backend from './Backend';
import QuerySet from './QuerySet';
import {
    ManyToMany,
    ForeignKey,
    OneToOne,
} from './fields';
import {CREATE, UPDATE, DELETE, ORDER} from './constants';
import {
    match,
    normalizeEntity,
    arrayDiffActions,
} from './utils';

/**
 * The heart of an ORM, the data model.
 * The static class methods manages the updates
 * passed to this. The class itself is connected to a session,
 * and because of this you can only have a single session at a time
 * for a {@link Model} class.
 *
 * An instance of {@link Model} represents an object in the database.
 *
 * To create data models in your schema, subclass {@link Model}. To define
 * information about the data model, override static class methods. Define instance
 * logic by defining prototype methods (without `static` keyword).
 */
const Model = class Model {
    /**
     * Creates a Model instance.
     * @param  {Object} props - the properties to instantiate with
     */
    constructor(props) {
        this._initFields(props);
    }

    _initFields(props) {
        const ModelClass = this.getClass();

        this._fieldNames = [];
        this._fields = props;
        const idAttribute = ModelClass.idAttribute;

        forOwn(props, (fieldValue, fieldName) => {
            this._fields[fieldName] = fieldValue;
            this._fieldNames.push(fieldName);

            // If the field has not already been defined on the
            // prototype for a relation.
            if (!ModelClass.definedProperties[fieldName]) {
                Object.defineProperty(this, fieldName, {
                    get: () => fieldValue,
                    set: (value) => {
                        ModelClass.addUpdate({
                            type: UPDATE,
                            payload: {
                                [idAttribute]: this.getId(),
                                [fieldName]: value,
                            },
                        });
                    },
                });
            }
        });
    }

    /**
     * Returns the raw state for this {@link Model} in the current {@link Session}.
     * @return {Object} The state for this {@link Model} in the current {@link Session}.
     */
    static get state() {
        return this.session.getState(this.modelName);
    }

    static toString() {
        return `ModelClass: ${this.modelName}`;
    }

    /**
     * Returns the options object passed to the {@link Backend} class constructor.
     *
     * @return {Object} the options object used to instantiate a {@link Backend} class.
     */
    static backend() {
        return {
            branchName: this.modelName,
        };
    }

    static _getBackendOpts() {
        if (typeof this.backend === 'function') {
            return this.backend();
        }
        if (typeof this.backend === 'undefined') {
            throw new Error(`You must declare either a 'backend' class method or
                            a 'backend' class variable in your Model Class`);
        }
        return this.backend;
    }

    /**
     * Returns the {@link Backend} class used to instantiate
     * the {@link Backend} instance for this {@link Model}.
     *
     * Override this if you want to use a custom {@link Backend} class.
     * @return {Backend} The {@link Backend} class or subclass to use for this {@link Model}.
     */
    static getBackendClass() {
        return Backend;
    }

    static get _sessionCache() {
        if (!this.hasOwnProperty('__sessionCache')) {
            this.__sessionCache = {};
        }
        return this.__sessionCache;
    }

    static clearSessionCache() {
        this.__sessionCache = {};
    }

    /**
     * Gets the {@link Backend} instance linked to this {@link Model}.
     * @return {Backend} The {@link Backend} instance linked to this {@link Model}.
     */
    static getBackend() {
        if (!this._sessionCache.backend) {
            const BackendClass = this.getBackendClass();

            const opts = this._getBackendOpts();
            if (this._session && this._session.withMutations) {
                opts.withMutations = true;
            }

            this._sessionCache.backend = new BackendClass(opts);
        }
        return this._sessionCache.backend;
    }

    /**
     * Gets the Model's next state by applying the recorded
     * updates.
     * @return {Object} The next state.
     */
    static getNextState() {
        if (typeof this.state === 'undefined') {
            return this.getDefaultState();
        }

        const updates = this.session.getUpdatesFor(this);

        return updates.reduce(this.updateReducer.bind(this), this.state);
    }

    static updateReducer(state, action) {
        const backend = this.getBackend();

        switch (action.type) {
        case CREATE:
            return backend.insert(state, action.payload);
        case UPDATE:
            return backend.update(state, action.payload.idArr, action.payload.updater);
        case ORDER:
            return backend.order(state, action.payload);
        case DELETE:
            return backend.delete(state, action.payload);
        default:
            return state;
        }
    }

    /**
     * The default reducer implementation.
     * If the user doesn't define a reducer, this is used.
     *
     * @param {Object} state - the current state
     * @param {Object} action - the dispatched action
     * @param {Model} model - the concrete model class being used
     * @param {Session} session - the current {@link Session} instance
     */
    static reducer(state, action, model, session) {
        return model.getNextState();
    }

    /**
     * Gets the default, empty state of the branch.
     * Delegates to a {@link Backend} instance.
     * @return {Object} The default state.
     */
    static getDefaultState() {
        return this.getBackend().getDefaultState();
    }

    static markAccessed() {
        this.session.markAccessed(this);
    }

    /**
     * Returns the id attribute of this {@link Model}.
     * Delegates to the related {@link Backend} instance.
     *
     * @return {string} The id attribute of this {@link Model}.
     */
    static get idAttribute() {
        return this.getBackend().idAttribute;
    }

    /**
     * A convenience method to call {@link Backend#accessId} from
     * the {@link Model} class.
     *
     * @param  {Number} id - the object id to access
     * @return {Object} a reference to the object in the database.
     */
    static accessId(id) {
        this.markAccessed();
        return this.getBackend().accessId(this.state, id);
    }

    /**
     * A convenience method to call {@link Backend#accessIdList} from
     * the {@link Model} class with the current state.
     */
    static accessIds() {
        this.markAccessed();
        return this.getBackend().accessIdList(this.state);
    }

    static accessList() {
        this.markAccessed();
        return this.getBackend().accessList(this.state);
    }

    static iterator() {
        this.markAccessed();
        return this.getBackend().iterator(this.state);
    }

    /**
     * Connect the model class to a {@link Session}. Invalidates
     * the session-specific cache.
     *
     * @param  {Session} session - The session to connect to.
     */
    static connect(session) {
        if (!session instanceof Session) {
            throw Error('A model can only connect to a Session instance.');
        }
        this._session = session;
        this.clearSessionCache();
    }

    /**
     * Get the current {@link Session} instance.
     *
     * @return {Session} The current {@link Session} instance.
     */
    static get session() {
        return this._session;
    }

    /**
     * A convenience method that delegates to the current {@link Session} instane.
     * Adds the required backenddata about this {@link Model} to the update object.
     * @param {Object} update - the update to add.
     */
    static addUpdate(update) {
        update.meta = {name: this.modelName};
        this.session.addUpdate(update);
    }

    /**
     * Returns the id to be assigned to a new entity.
     * You may override this to suit your needs.
     * @return {*} the id value for a new entity.
     */
    static nextId() {
        if (typeof this._sessionCache.nextId === 'undefined') {
            const idArr = this.accessIds();
            if (idArr.length === 0) {
                this._sessionCache.nextId = 0;
            } else {
                this._sessionCache.nextId = Math.max(...idArr) + 1;
            }
        }
        return this._sessionCache.nextId;
    }

    static getQuerySet() {
        return this.getQuerySetFromIds(this.accessIds());
    }

    static getQuerySetFromIds(ids) {
        const QuerySetClass = this.querySetClass;
        return new QuerySetClass(this, ids);
    }

    static invalidateClassCache() {
        this.isSetUp = undefined;
        this.definedProperties = {};
        this.virtualFields = {};
    }

    static get query() {
        if (!this._sessionCache.queryset) {
            this._sessionCache.queryset = this.getQuerySet();
        }
        return this._sessionCache.queryset;
    }

    /**
     * Returns a {@link QuerySet} containing all {@link Model} instances.
     * @return {QuerySet} a QuerySet containing all {@link Model} instances
     */
    static all() {
        return this.getQuerySet();
    }

    /**
     * Records the addition of a new {@link Model} instance if it doesn't exist yet.
     * Else update it.
     *
     * @param  {props} props - the new {@link Model}'s properties.
     * @return {Model} a new {@link Model} instance.
     */
    static createOrMergeById(userProps) {
        const idAttribute = this.idAttribute;
        const idValue = userProps[idAttribute];
        if (idValue === 'undefined' || idValue === null) {
            throw new Error("Id is empty!");
            return;
        }
        const model = this.withId(idValue);
        if (model && model.id) {
            model.update(userProps);
        } else {
            this.create(userProps);
        }
    }

    /**
     * Records the addition of a new {@link Model} instance and returns it.
     *
     * @param  {props} props - the new {@link Model}'s properties.
     * @return {Model} a new {@link Model} instance.
     */
    static create(userProps) {
        const idAttribute = this.idAttribute;
        const props = Object.assign({}, userProps);

        if (!props.hasOwnProperty(idAttribute)) {
            const nextId = this.nextId();
            props[idAttribute] = nextId;
            this._sessionCache.nextId++;
        } else {
            const id = props[idAttribute];
            if (id > this.nextId()) {
                this._sessionCache.nextId = id + 1;
            }
        }

        const m2mVals = {};

        forOwn(userProps, (value, key) => {
            props[key] = normalizeEntity(value);

            // If a value is supplied for a ManyToMany field,
            // discard them from props and save for later processing.
            if (isArray(value)) {
                if (this.fields.hasOwnProperty(key) && this.fields[key] instanceof ManyToMany) {
                    m2mVals[key] = value;
                    delete props[key];
                }
            }
        });

        this.addUpdate({
            type: CREATE,
            payload: props,
        });
        const ModelClass = this;
        const instance = new ModelClass(props);

        forOwn(m2mVals, (value, key) => {
            const ids = value.map(normalizeEntity);
            instance[key].add(...ids);
        });

        return instance;
    }

    static withId(id) {
        const ModelClass = this;
        return new ModelClass(this.accessId(id));
    }

    /**
     * Gets the {@link Model} instance that matches properties in `lookupObj`.
     * Throws an error if {@link Model} is not found.
     *
     * @param  {Object} lookupObj - the properties used to match a single entity.
     * @return {Model} a {@link Model} instance that matches `lookupObj` properties.
     */
    static get(lookupObj) {
        if (!this.accessIds().length) {
            throw new Error(`No entities found for model ${this.modelName}`);
        }
        const ModelClass = this;

        // We treat `idAttribute` as unique, so if it's
        // in `lookupObj` we search with that attribute only.
        if (lookupObj.hasOwnProperty(this.idAttribute)) {
            const props = this.accessId(lookupObj[this.idAttribute]);
            if (typeof props !== 'undefined') {
                return new ModelClass(props);
            }

            throw new Error('Model instance not found when calling get method');
        }

        const iterator = this.iterator();

        let done = false;
        while (!done) {
            const curr = iterator.next();
            if (match(lookupObj, curr.value)) {
                return new ModelClass(curr.value);
            }
            done = curr.done;
        }

        throw new Error('Model instance not found when calling get method');
    }

    /**
     * Records an ordering update for the objects.
     * Note that if you create or update any objects after
     * calling this, they won't be in order.
     *
     * @param {function|string|string[]} orderArg - A function, an attribute name or a list of attribute
     *                                              names to order the objects by. If you supply a function,
     *                                              it must return a value user to order the entities.
     * @return {undefined}
     */
    static setOrder(orderArg) {
        this.addUpdate({
            type: ORDER,
            payload: orderArg,
        });
    }

    /**
     * Gets the {@link Model} class or subclass constructor (the class that
     * instantiated this instance).
     *
     * @return {Model} The {@link Model} class or subclass constructor used to instantiate
     *                 this instance.
     */
    getClass() {
        return this.constructor;
    }

    /**
     * Gets the id value of the current instance.
     * @return {*} The id value of the current instance.
     */
    getId() {
        return this._fields[this.getClass().idAttribute];
    }

    /**
     * Returns a string representation of the {@link Model} instance.
     * @return {string} A string representation of this {@link Model} instance.
     */
    toString() {
        const className = this.getClass().modelName;
        const fields = this._fieldNames.map(fieldName => {
            const val = this._fields[fieldName];
            return `${fieldName}: ${val}`;
        }).join(', ');
        return `${className}: {${fields}}`;
    }

    equals(otherModel) {
        return this.getClass() === otherModel.getClass() && this.getId() === otherModel.getId();
    }

    /**
     * Returns a plain JavaScript object representation
     * of the {@link Model} instance.
     * @return {Object} a plain JavaScript object representing the {@link Model}
     */
    toPlain() {
        const obj = {};
        this._fieldNames.forEach((fieldName) => {
            obj[fieldName] = this._fields[fieldName];
        });
        return obj;
    }

    /**
     * Records a update to the {@link Model} instance for a single
     * field value assignment.
     * @param {string} propertyName - name of the property to set
     * @param {*} value - value assigned to the property
     * @return {undefined}
     */
    set(propertyName, value) {
        this.update({[propertyName]: value});
    }

    /**
     * Records a update to the {@link Model} instance for multiple field value assignments.
     * @param  {Object} userMergeObj - an object that will be merged with this instance.
     * @return {undefined}
     */
    update(userMergeObj) {
        const relFields = this.getClass().fields;
        const mergeObj = Object.assign({}, userMergeObj);

        // If an array of entities or id's is supplied for a
        // many-to-many related field, clear the old relations
        // and add the new ones.
        for (const mergeKey in mergeObj) {
            if (relFields.hasOwnProperty(mergeKey)) {
                const field = relFields[mergeKey];
                if (field instanceof ManyToMany) {
                    const currentIds = this[mergeKey].idArr;

                    // TODO: It could be better to check this stuff in Backend.
                    const normalizedNewIds = mergeObj[mergeKey].map(normalizeEntity);
                    const diffActions = arrayDiffActions(currentIds, normalizedNewIds);
                    if (diffActions) {
                        const idsToDelete = diffActions.delete;
                        const idsToAdd = diffActions.add;

                        if (idsToDelete.length > 0) {
                            this[mergeKey].remove(...idsToDelete);
                        }
                        if (idsToAdd.length > 0) {
                            this[mergeKey].add(...idsToAdd);
                        }
                    }
                    delete mergeObj[mergeKey];
                } else if (field instanceof ForeignKey || field instanceof OneToOne) {
                    mergeObj[mergeKey] = normalizeEntity(mergeObj[mergeKey]);
                }
            }
        }

        this.getClass().addUpdate({
            type: UPDATE,
            payload: {
                idArr: [this.getId()],
                updater: mergeObj,
            },
        });
    }

    /**
     * Records the {@link Model} to be deleted.
     * @return {undefined}
     */
    delete() {
        this.getClass().addUpdate({
            type: DELETE,
            payload: [this.getId()],
        });
        this._onDelete();
    }

    _onDelete() {
        const virtualFields = this.getClass().virtualFields;
        for (const key in virtualFields) { // eslint-disable-line
            const field = virtualFields[key];
            if (field instanceof ManyToMany) {
                // Delete any many-to-many rows the entity is included in.
                this[key].clear();
            } else if (field instanceof ForeignKey) {
                const relatedQs = this[key];
                if (relatedQs.exists()) {
                    relatedQs.update({[field.relatedName]: null});
                }
            } else if (field instanceof OneToOne) {
                // Set null to any foreign keys or one to ones pointed to
                // this instance.
                if (this[key] !== null ) {
                    this[key][field.relatedName] = null;
                }
            }
        }
    }
};

Model.fields = {};
Model.definedProperties = {};
Model.virtualFields = {};
Model.querySetClass = QuerySet;

export default Model;
