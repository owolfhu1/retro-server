const MongoClient = require('mongodb').MongoClient;
const URL = 'mongodb://orion:pass12@ds251618.mlab.com:51618/heroku_dhbcgtr7';
const DATABASE = 'heroku_dhbcgtr7';

const startInstance = (title, votesAllowed, owner, callback) => {
    if (!title || title.indexOf(' ') >= 0 || votesAllowed < 0) {
        callback('bad input');
        return;
    }
    MongoClient.connect(URL,  (err, db) => {
        if (err) throw err;
        let dbo = db.db(DATABASE);
        dbo.collection('instances').findOne({title}, (err, result) => {
            if (err) throw err;
            if (!result) {
                const instance = {
                    title,
                    votesAllowed,
                    owner,
                    locked: false,
                    goods: [],
                    bads: [],
                    actions: [],
                    trash: [],
                    users: [ owner ],
                    votes: { [owner]: votesAllowed },
                };
                dbo.collection('instances').insertOne(
                    instance,
                    (err, res) => {
                        if (err) throw err;
                        callback(instance);
                        db.close();
                    }
                );
            } else {
                callback(false);
                db.close();
            }
        });
    });
};

const updateInstance = instance => {
    MongoClient.connect(URL,  (err, db) => {
        if (err) throw err;
        let dbo = db.db(DATABASE);
        dbo.collection('instances').findOneAndUpdate({title: instance.title}, {$set: instance}, (err, res) => {
            if (err) throw err;
        });
    });
};

const loadInstance = (instanceId, callback) => {
    MongoClient.connect(URL,  (err, db) => {
        if (err) throw err;
        let dbo = db.db(DATABASE);
        dbo.collection('instances').findOne({title: instanceId}, (err, res) => {
            if (err) throw err;
            callback(res);
        });
    });
};







module.exports = { startInstance, updateInstance, loadInstance };
