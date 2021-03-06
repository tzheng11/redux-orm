redux-orm
===============

A small, simple and immutable ORM to manage data in your Redux store.

Not ready for production.

See an [example app using redux-orm](https://github.com/tommikaikkonen/redux-orm-example).

[![npm version](https://img.shields.io/npm/v/redux-orm.svg?style=flat-square)](https://www.npmjs.com/package/redux-orm)
[![npm downloads](https://img.shields.io/npm/dm/redux-orm.svg?style=flat-square)](https://www.npmjs.com/package/redux-orm)

## Installation

```bash
npm install redux-orm --save
```

## Usage

### Declare Your Models

You can declare your models with the ES6 class syntax, extending from `Model`. You are not required to declare normal fields, only fields that relate to another model. `redux-orm` supports one-to-one and many-to-many relations in addition to foreign keys (`oneToOne`, `many` and `fk` imports respectively). Non-related properties can be accessed like in normal JavaScript objects.

```javascript
// models.js
import {fk, many, Model} from 'redux-orm';

class Book extends Model {
    toString() {
        return `Book: ${this.name}`;
    }
    // Declare any static or instance methods you need.
}
Book.modelName = 'Book';

// Declare your related fields.
Book.fields = {
    authors: many('Author', 'books'),
    publisher: fk('Publisher', 'books'),
};
```

### Write Your Model-Specific Reducers

Every `Model` has it's own reducer. It'll be called every time Redux dispatches an action and by default it returns the previous state. You can declare your own reducers inside your models as `static reducer()`, or write your reducer elsewhere and connect it to `redux-orm` later. The reducer receives the following arguments: the previous state, the current action, the model class connected to the state, and finally the `Session` instance. Here's our extended Book model declaration with a reducer:

```javascript
// models.js
class Book extends Model {
    static reducer(state, action, Book) {
        switch (action.type) {
        case 'CREATE_BOOK':
            Book.create(action.payload);
            break;
        case 'UPDATE_BOOK':
            Book.withId(action.payload.id).update(action.payload);
            break;
        case 'REMOVE_BOOK':
            const book = Book.withId(action.payload);
            book.delete();
            break;
        case 'ADD_AUTHOR_TO_BOOK':
            Book.withId(action.payload.bookId).authors.add(action.payload.author);
            break;
        case 'REMOVE_AUTHOR_FROM_BOOK':
            Book.withId(action.payload.bookId).authors.remove(action.payload.authorId);
            break;
        case 'ASSIGN_PUBLISHER':
            Book.withId(action.payload.bookId).publisher = action.payload.publisherId;
            break;
        }

        return Book.getNextState();
    }

    toString() {
        return `Book: ${this.name}`;
    }
}

// Below we would declare Author and Publisher models
```

### Connect to Redux

To create our data schema, we create a Schema instance and register our models.

```javascript
// schema.js
import {Schema} from 'redux-orm';
import {Book, Author, Publisher} from './models';

const schema = new Schema();
schema.register(Book, Author, Publisher);

export default schema;
```

`Schema` instances expose a `reducer` method that returns a reducer you can use to plug into Redux. Preferably in your root reducer, plug the reducer under a namespace of your choice:

```javascript
// main.js
import schema from './schema';
import {combineReducers} from 'redux';

const rootReducer = combineReducers({
    orm: schema.reducer()
});
```

### Use with React

Use memoized selectors to make queries into the state. `redux-orm` uses smart memoization: the below selector accesses `Author` and `AuthorBooks` branches (`AuthorBooks` is a many-to-many branch generated from the model field declarations), and the selector will be recomputed only if those branches change. The accessed branches are resolved on the first run.

```javascript
// selectors.js
import schema from './schema';
const authorSelector = schema.createSelector(session => {
    return session.Author.map(author => {
        // Returns a shallow copy of the raw author object,
        // so it doesn't include any reverse or m2m fields.
        const obj = author.toPlain();
        // Object.keys(obj) === ['id', 'name']

        return Object.assign(obj, {
            books: author.books.plain.map(book => book.name),
        });
    });
});

// Will result in something like this when run:
// [
//   {
//     id: 0,
//     name: 'Tommi Kaikkonen',
//     books: ['Introduction to redux-orm', 'Developing Redux applications'],
//   },
//   {
//     id: 1,
//     name: 'John Doe',
//     books: ['John Doe: an Autobiography']
//   }
// ]
```

Selectors created with `schema.createSelector` can be used as input to any additional `reselect` selectors you want to use. They are also great to use with `redux-thunk`: get the whole state with `getState()`, pass the ORM branch to the selector, and get your results. A good use case is serializing data to a custom format for a 3rd party API call.

Because selectors are memoized, you can use pure rendering in React for performance gains.

```javascript
// components.js
import PureComponent from 'react-pure-render/component';
import {authorSelector} from './selectors';
import {connect} from 'react-redux';

class App extends PureComponent {
    render() {
        const authors = this.props.authors.map(author => {
            return (
                <li key={author.id}>
                    {author.name} has written {author.books.join(', ')}
                </li>
            );
        });

        return (
            <ul>
                {authors}
            </ul>
        );
    }
}

function mapStateToProps(state) {
    return {
        authors: authorSelector(state.orm),
    };
}

export default connect(mapStateToProps)(App);
```

## Understanding redux-orm

### An ORM?

Well, yeah. `redux-orm` deals with related data, structured similar to a relational database. The database in this case is a simple JavaScript object database.

### Why?

For simple apps, writing reducers by hand is alright, but when the number of object types you have increases and you need to maintain relations between them, things get hairy. ImmutableJS goes a long way to reduce complexity in your reducers, but `redux-orm` is specialized for relational data.

### Reducers and Immutability

Say we're inside a reducer and want to update the name of a book.

```javascript
const book = Book.withId(action.payload.id)
book.name // 'Refactoring'
book.name = 'Clean Code'
book.name // 'Refactoring'
```

Assigning a new value has no effect on the current state. Behind the scenes, an update to the data was recorded. When you call

```javascript
Book.getNextState()
// the item we edited will have now values {... name: 'Clean Code'}
```

the update will be reflected in the new state. The same principle holds true when you're creating new instances, deleting them and ordering them.

### How Updates Work Internally

By default, each Model has the following JavaScript object representation:

```javascript
{
    items: [],
    itemsById: {},
}
```

This representation maintains an array of object ID's and an index of id's for quick access. (A single object array representation is also provided for use. It is possible to subclass `Backend` to use any structure you want).

`redux-orm` runs a mini-redux inside it. It queues any updates the library user records with action-like objects, and when `getNextState` is called, it applies those actions with its internal reducers. There's some room here to provide performance optimizations similar to Immutable.js.

### Customizability

Just like you can extend `Model`, you can do the same for `QuerySet` (customize methods on Model instance collections) and `Backend` (customize store access and updates).

### Caveats

The ORM abstraction will never be as performant compared to writing reducers by hand, and adds to the build size of your project (last I checked, minimizing the source files and gzipping yielded about 8 KB). If you have very simple data without relations, `redux-orm` may be overkill. The development convenience benefit is considerable though.

## API

### Schema

See the full documentation for Schema [here](http://tommikaikkonen.github.io/redux-orm/Schema.html)

Instantiation

```javascript
const schema = new Schema(); // no arguments needed.
```

Instance methods:

- `register(model1, model2, ...modelN)`: registers Model classes to the `Schema` instance.
- `define(name, [relatedFields], [backendOpts])`: shortcut to define and register simple models.
- `from(state, [action])`: begins a new `Session` with `state`. If `action` is omitted, the session can be used to query the state data.
- `reducer()`: returns a reducer function that can be plugged into Redux. The reducer will return the next state of the database given the provided action. You need to register your models before calling this.
- `createSelector([...inputSelectors], selectorFunc)`: returns a memoized selector function for `selectorFunc`. `selectorFunc` receives `session` as the first argument, followed by any inputs from `inputSelectors`. Read the full documentation for details.

### Model

See the full documentation for `Model` [here](http://tommikaikkonen.github.io/redux-orm/Model.html).

**Instantiation**: Don't instantiate directly; use class method `create`.

**Class Methods**:

- `withId(id)`: gets the Model instance with id `id`.
- `get(matchObj)`: to get a Model instance based on matching properties in `matchObj`,
- `create(props)`: to create a new Model instance with `props`. If you don't supply an id, the new `id` will be `Math.max(...allOtherIds) + 1`. You can override the `nextId` class method on your model.

You will also have access to almost all [QuerySet instance methods](http://tommikaikkonen.github.io/redux-orm/QuerySet.html) from the class object for convenience.

**Instance methods**:

- `toPlain`: returns a plain JavaScript object presentation of the Model.
- `set`: marks a supplied `propertyName` to be updated to `value` at `Model.getNextState`. Returns `undefined`. Is equivalent to normal assignment.
- `update`: marks a supplied object of property names and values to be merged with the Model instance at `Model.getNextState()`. Returns `undefined`.
- `delete`: marks the Model instance to be deleted at `Model.getNextState()`. Returns `undefined`.

**Subclassing**:

Use the ES6 syntax to subclass from `Model`. Any instance methods you declare will be available on Model instances. Any static methods you declare will be available on the Model class in Sessions.

For the related fields declarations, either set the `fields` property on the class or declare a static getter that returns the field declarations like this:

**Declaring `fields`**:
```javascript
class Book extends Model {
    static get fields() {
        return {
            author: fk('Author')
        };
    }
}
// alternative:
Book.fields = {
    author: fk('Author')
}
```

All the fields `fk`, `oneToOne` and `many` take a single argument, the related model name. The fields will be available as properties on each `Model` instance. You can set related fields with the id value of the related instance, or the related instance itself. 

For `fk`, you can access the reverse relation through `author.bookSet`, where the related name is `${modelName}Set`. Same goes for `many`. For `oneToOne`, the reverse relation can be accessed by just the model name the field was declared on: `author.book`.

For `many` field declarations, accessing the field on a Model instance will return a `QuerySet` with two additional methods: `add` and `remove`. They take 1 or more arguments, where the arguments are either Model instances or their id's. Calling these methods records updates that will be reflected in the next state.

When declaring model classes, always remember to set the `modelName` property. It needs to be set explicitly, because running your code through a mangler would otherwise break functionality. The `modelName` will be used to resolve all related fields. 

**Declaring `backend`**:
```javascript
class Book extends Model {
    static get modelName() {
        return 'Book';
    }
}
// alternative:
Book.modelName = 'Book';
```



### QuerySet

See the full documentation for `QuerySet` [here](http://tommikaikkonen.github.io/redux-orm/QuerySet.html).

You can access all of these methods straight from a `Model` class, as if they were class methods on `Model`. In this case the functions will operate on a QuerySet that includes all the Model instances.

**Instance methods**:

- `toPlain()`: returns the `Model` instances in `QuerySet`  as an array of plain JavaScript objects.
- `count()`: returns the number of `Model` instances in the `QuerySet`.
- `exists()`: return `true` if number of entities is more than 0, else `false`.
- `filter(filterArg)`: returns a new `QuerySet` with the entities that pass the filter. For `filterArg`, you can either pass an object that `redux-orm` tries to match to the entities, or a function that returns `true` if you want to have it in the new `QuerySet`, `false` if not.
- `exclude` returns a new `QuerySet` with the entities that do not pass the filter. Similarly to `filter`, you may pass an object for matching (all entities that match will not be in the new `QuerySet`) or a function.
- `map(func)` map the entities in `QuerySet`, returning a JavaScript array.
- `all()` returns a new `QuerySet` with the same entities.
- `at(index)` returns an `Model` instance at the supplied `index` in the `QuerySet`.
- `first()` returns an `Model` instance at the `0` index.
- `last()` returns an `Model` instance at the `querySet.count() - 1` index.
- `delete()` marks all the `QuerySet` entities for deletion on `Model.getNextState`.
- `update(updateArg)` marks all the `QuerySet` entities for an update based on the supplied argument. The argument can either be an object that will be merged with the entity, or a mapping function that takes the entity as an argument and **returns a new, updated entity**. Do not mutate the entity if you pass a function to `update`.

**Plain/models flagging**

When you want to iterate through all entities with `filter`, `exclude`, `forEach`, `map`, or get an item with `first`, `last` or `at`, you don't always need access to the full Model instance - a plain JavaScript object could do. QuerySets maintain a flag indicating whether these methods operate on plain JavaScript objects (a straight reference from the store) or a Model instances that are instantiated during the operations.

```javascript
const clean = Book.plain.filter(book => book.author === 'Tommi Kaikkonen')
// `book` is a plain javascript object, `clean` is a QuerySet
// 
const clean2 = Book.filter(book => book.name === 'Tommi Kaikkonen - An Autobiography')
// `book` is a Model instance. `clean2` is a QuerySet equivalent to `clean`.
```

The flag persists after settings the flag. The default is to operate on Model instances. You can invert the flag by chaining `plain`. You can flip it back with `models`.

```javascript
clean.filter(book => book.release_year > 2014)
// Since the plain flag was used in `clean`, `book` is a plain instance.

clean.models.filter(book => book.isReleasedAfterYear(2014))
// `models` inverts the flag, `book` is a Model instance.
```

### Session

See the full documentation for Session [here](http://tommikaikkonen.github.io/redux-orm/Session.html)

**Instantiation**: you don't need to do this yourself. Use `schema.from`.

**Instance properties**:
You can access all the registered Models in the schema for querying and updates as properties of this instance. For example, given a schema with `Book` and `Author` models,

```javascript
const session = schema.from(state, action);
session.Book // Model class: Book
session.Author // Model class: Author
session.Book.create({id: 5, name: 'Refactoring', release_year: 1999});
```


### Backend

Backend implements the logic and holds the information for Models' underlying data structure. If you want to change how that works, subclass `Backend` or implement your own with the same interface, and override your models' `getBackendClass` classmethod.

See the full documentation for `Backend` [here](http://tommikaikkonen.github.io/redux-orm/Backend.html)

**Instantiation**: will be done for you. If you want to specify custom options, you can override the `YourModelClass.backend` property with the custom options that will be merged with the defaults. For most cases, the default options work well. They are:

```javascript
{
    idAttribute: 'id',
    indexById: true, // if false, data will be held in a single object array
    ordered: true,
    arrName: 'items',
    mapName: 'itemsById', // will be ignored if `indexById` is `false`
};
```

## License

MIT. See `LICENSE`