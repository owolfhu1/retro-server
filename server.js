const server = require('express')();
const http = require('http').Server(server);
const io = require('socket.io')(http);
const port = process.env.PORT || 4242;

const { startInstance, updateInstance, loadInstance } = require('./database');

const liveInstances = {};
const ids = {};

http.listen(port);

io.on('connection', socket => {
    console.log('client connected: ', socket.id);

    let name;
    let instanceId;

    const isActive = () => {
        if (!name || !instanceId ||socket.id !== ids[name] || !liveInstances[instanceId]) {
            socket.emit('reset');
            return false;
        }
        return true;
    };

    socket.on('ping', console.log);

    socket.on('start', data => {
        startInstance(data.title, data.votesAllowed, data.owner, result => {
            if (result) {
                name = data.owner;
                instanceId = data.title;
                ids[name] = socket.id;
                liveInstances[data.title] = result;
                socket.emit('goToInstance', { instance: result, name: data.owner });
            } else
                socket.emit('test', 'that instance has already been created');
        });
    });

    const types = ['goods', 'bads', 'actions'];
    for (let i in types) {
        const type = types[i];
        socket.on('new-' + type, text => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                instance[type].push({
                    text,
                    comments: [],
                    ups: 0,
                    downs: 0,
                    id: id(),
                    author: name,
                });
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    }

    socket.on('drop', data => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            const item = instance[data.lastList].splice(data.lastIndex, 1)[0];
            instance[data.nextList].splice(data.nextIndex, 0, item);
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('join', data => {
        if (liveInstances[data.instanceId]) {
            const instance = liveInstances[data.instanceId];
            name = data.name;
            instanceId = data.instanceId;
            ids[name] = socket.id;
            if (instance.users.indexOf(name) < 0) {
                instance.users.push(name);
                updateInstance(instance);
            }
            if (!instance.votes[name] && instance.votes[name] !== 0) {
                instance.votes[name] = instance.votesAllowed;
            }
            socket.emit('set-name', name);
            socket.emit('instance', instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        } else {
            loadInstance(data.instanceId, instance => {
                if (instance) {
                    name = data.name;
                    instanceId = data.instanceId;
                    ids[name] = socket.id;
                    liveInstances[data.instanceId] = instance;
                    if (instance.users.indexOf(name) < 0) {
                        instance.users.push(name);
                        updateInstance(instance)
                    }
                    socket.emit('set-name', name);
                    socket.emit('instance', instance);
                    instance.users.forEach(user => {
                        io.to(ids[user]).emit('instance', instance);
                    });
                } else {
                    socket.emit('test', 'That instance does not exist.');
                }
            });
        }
    });

    const directions = ['ups', 'downs'];

    directions.forEach(type => {
        socket.on('vote-' + type, statementId => {
            if(isActive()) {
                const instance = liveInstances[instanceId];
                if (instance.votes[name] > 0) {
                    const statement = getStatement(instance, statementId);
                    if (!statement) return;
                    statement[type]++;
                    instance.votes[name]--;
                    updateInstance(instance);
                    instance.users.forEach(user => {
                        io.to(ids[user]).emit('instance', instance);
                    });
                } else {
                    socket.emit('test', 'you are out of votes');
                }
            }
        });

        socket.on('comment-vote-' + type, data => {
            if(isActive()) {
                const instance = liveInstances[instanceId];
                if (instance.votes[name] > 0) {
                    const statement = getStatement(instance, data.statementId);
                    if (!statement) return;
                    statement.comments[data.index][type]++;
                    instance.votes[name]--;
                    updateInstance(instance);
                    instance.users.forEach(user => {
                        io.to(ids[user]).emit('instance', instance);
                    });
                } else {
                    socket.emit('test', 'you are out of votes');
                }
            }
        });
    });

    socket.on('edit', data => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            const statement = getStatement(instance, data.statementId);
            if (!statement) return;
            statement.text = data.text;
            statement.isEdited = true;
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('comment', data => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            const statement = getStatement(instance, data.statementId);
            if (!statement) return;
            statement.comments.push({
                text: data.text,
                ups: 0,
                downs: 0,
            });
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('trash', data => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            const item = instance[data.lastList].splice(data.lastIndex, 1)[0];
            item.from = data.lastList === 'trash' ? item.from : data.lastList;

            if (data.lastList === 'trash')
                instance.trash.splice(data.nextIndex, 0, item);
            else
                instance.trash.unshift(item);
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('delete', index => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            if (instance.trash.length <= index) return;
            instance.trash.splice(index, 1);
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('delete-all', () => {
        if (isActive()) {
            const instance = liveInstances[instanceId];
            instance.trash = [];
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    });

    socket.on('disconnect', () => {
        if (name) {
            const instance = liveInstances[instanceId];
            instance.users.splice(instance.users.indexOf(name), 1);
            delete ids[name];
            updateInstance(instance);
            instance.users.forEach(user => {
                io.to(ids[user]).emit('instance', instance);
            });
        }
    })
});

console.log('listening on 4242');

const getStatement = (instance, statementId) => {
    let statement;
    instance.goods.forEach(x => {
        if (x.id === statementId) {
            statement = x;
        }
    });
    instance.bads.forEach(x => {
        if (x.id === statementId) {
            statement = x;
        }
    });
    instance.actions.forEach(x => {
        if (x.id === statementId) {
            statement = x;
        }
    });
    instance.trash.forEach(x => {
        if (x.id === statementId) {
            statement = x;
        }
    });
    return statement;
};

const id = () => 'id-' + (Math.random()*0xFFFFFF<<0).toString(16);
