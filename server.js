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

    const tryIt = callback => {
        try {
            callback();
        } catch(error) {
            socket.emit('test', 'Something went wrong.');
        }
    };

    const isActive = () => {
        if (!name || !instanceId ||socket.id !== ids[name] || !liveInstances[instanceId]) {
            socket.emit('reset');
            return false;
        }
        return true;
    };

    socket.on('ping', console.log);

    socket.on('start', data => {
        tryIt(() => {
            startInstance(data.title, data.votesAllowed, data.negativeVotesAllowed, data.owner, data.emojiAllowed, result => {
                if (result) {
                    name = data.owner;
                    instanceId = data.title;
                    ids[name] = socket.id;
                    liveInstances[data.title] = result;
                    socket.emit('goToInstance', {instance: result, name: data.owner});
                } else
                    socket.emit('test', 'that instance has already been created');
            });
        });
    });

    const types = ['goods', 'bads', 'actions'];
    types.forEach(type => {
        socket.on('new-' + type, text => {
            tryIt(() => {
                if (isActive()) {
                    const instance = liveInstances[instanceId];
                    instance[type].push({
                        text,
                        comments: [],
                        emoji: [],
                        ups: [],
                        downs: [],
                        id: id(),
                        author: name,
                    });
                    updateInstance(instance);
                    instance.users.forEach(user => {
                        io.to(ids[user]).emit('instance', instance);
                    });
                }
            });

        });
    });

    socket.on('emoji', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.id);
                if (!statement) return socket.emit('instance', instance);
                addOrRemoveEmoji(name, data.emoji, statement.emoji);
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('comment-emoji', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.id);
                if (!statement) return socket.emit('instance', instance);
                const comment = getComment(statement, data.commentId);
                if (!comment) return socket.emit('instance', instance);
                addOrRemoveEmoji(name, data.emoji, comment.emoji);
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('drop', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                if (!isValidInstanceIndexData(instance, data)) {
                    socket.emit('instance', instance);
                    return;
                }
                const item = instance[data.lastList].splice(data.lastIndex, 1)[0];
                instance[data.nextList].splice(data.nextIndex, 0, item);
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('join', data => {
        tryIt(() => {
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
                        instance.users = [];
                        name = data.name;
                        instanceId = data.instanceId;
                        ids[name] = socket.id;
                        liveInstances[data.instanceId] = instance;
                        instance.users.push(name);
                        updateInstance(instance);
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
    });

    const directions = ['ups', 'downs'];

    socket.on('lock-trash', () => {
        tryIt(() => {
            if(isActive()) {
                const instance = liveInstances[instanceId];
                if (name !== instance.owner) return socket.emit('test', 'Only the instance owner can toggle the trash lock.');
                instance.trashIsLocked = !instance.trashIsLocked; // bang
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    directions.forEach(type => {
        socket.on('vote-' + type, statementId => {
            tryIt(() => {
                if(isActive()) {
                    const instance = liveInstances[instanceId];
                    if (instance.votes[name] > 0) {
                        const statement = getStatement(instance, statementId);
                        if (!statement) return socket.emit('instance', instance);
                        statement[type].push(name);
                        instance.votes[name]--;
                        updateInstance(instance);
                        instance.users.forEach(user => {
                            io.to(ids[user]).emit('instance', instance);
                        });
                    } else {
                        socket.emit('test', 'You are out of votes.');
                    }
                }
            });
        });

        socket.on('un-vote-' + type, statementId => {
            tryIt(() => {
                if(isActive()) {
                    const instance = liveInstances[instanceId];
                    const statement = getStatement(instance, statementId);
                    if (!statement) return socket.emit('instance', instance);
                    if (statement[type].indexOf(name) > -1) {
                        statement[type].splice(statement[type].indexOf(name), 1);
                        instance.votes[name]++;
                        updateInstance(instance);
                        instance.users.forEach(user => {
                            io.to(ids[user]).emit('instance', instance);
                        });
                    } else {
                        socket.emit('test', 'You have not voted on that.');
                    }
                }
            });

        });

        socket.on('comment-vote-' + type, data => {
            tryIt(() => {
                if(isActive()) {
                    const instance = liveInstances[instanceId];
                    if (instance.votes[name] > 0) {
                        const statement = getStatement(instance, data.statementId);
                        if (!statement) return  socket.emit('instance', instance);
                        const comment = getComment(statement, data.commentId);
                        if (!comment) return  socket.emit('instance', instance);
                        comment[type].push(name);
                        instance.votes[name]--;
                        updateInstance(instance);
                        instance.users.forEach(user => {
                            io.to(ids[user]).emit('instance', instance);
                        });
                    } else {
                        socket.emit('test', 'You are out of votes.');
                    }
                }
            });
        });

        socket.on('un-comment-vote-' + type, data => {
            tryIt(() => {
                if(isActive()) {
                    const instance = liveInstances[instanceId];
                    const statement = getStatement(instance, data.statementId);
                    if (!statement) return socket.emit('instance', instance);
                    const comment = getComment(statement, data.commentId);
                    if (!comment) return socket.emit('instance', instance);
                    if (comment[type].indexOf(name) > -1) {
                        comment[type].splice(comment[type].indexOf(name), 1);
                        instance.votes[name]++;
                        updateInstance(instance);
                        instance.users.forEach(user => {
                            io.to(ids[user]).emit('instance', instance);
                        });
                    } else {
                        socket.emit('test', 'You have not voted on that.');
                    }
                }
            });
        });
    });

    socket.on('edit', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.statementId);
                if (!statement) return socket.emit('instance', instance);
                statement.text = data.text;
                statement.isEdited = true;
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('comment', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.statementId);
                if (!statement) return socket.emit('instance', instance);
                statement.comments.push({
                    text: data.text,
                    ups: [],
                    downs: [],
                    author: name,
                    id: id(),
                    emoji: [],
                });
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('edit-comment', data => {
        tryIt(() => {
            if(isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.statementId);
                if (!statement) return  socket.emit('instance', instance);
                const comment = getComment(statement, data.commentId);
                if (!comment) return  socket.emit('instance', instance);
                comment.text = data.text;
                comment.isEdited = true;
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('delete-comment', data => {
        tryIt(() => {
            if(isActive()) {
                const instance = liveInstances[instanceId];
                const statement = getStatement(instance, data.statementId);
                if (!statement) return  socket.emit('instance', instance);
                const comment = getComment(statement, data.commentId);
                if (!comment) return  socket.emit('instance', instance);
                removeVotesFromStatement(instance, comment, true);
                statement.comments.splice(statement.comments.indexOf(comment), 1);
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    const isValidInstanceIndexData = (instance, data) => {
        const item = instance[data.lastList][data.lastIndex];
        return !!item && item.id === data.id;
    };

    socket.on('trash', data => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                if (!isValidInstanceIndexData(instance, data)) {
                    socket.emit('instance', instance);
                    return;
                }
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
    });

    // TODO make this safe for when 2 people try to delete the same thing at nearly same time
    socket.on('delete', index => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                if (instance.trashIsLocked) return socket.emit('test', 'You can not hard delete trash when it is locked.');
                if (instance.trash.length <= index) return socket.emit('instance', instance); // <-- improve here
                removeVotesFromStatement(instance, instance.trash[index]);
                instance.trash.splice(index, 1);
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('delete-all', () => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                if (instance.trashIsLocked) return socket.emit('test', 'You can not hard delete trash when it is locked.');
                instance.trash.forEach(statement => removeVotesFromStatement(instance, statement));
                instance.trash = [];
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });

    socket.on('lock', () => {
        tryIt(() => {
            if (isActive()) {
                const instance = liveInstances[instanceId];
                if (instance.owner === name) {
                    instance.locked = !instance.locked;
                    updateInstance(instance);
                    instance.users.forEach(user => {
                        io.to(ids[user]).emit('instance', instance);
                    });
                }
            }
        });
    });

    socket.on('disconnect', () => {
        tryIt(() => {
            if (name) {
                const instance = liveInstances[instanceId];
                instance.users.splice(instance.users.indexOf(name), 1);
                delete ids[name];
                updateInstance(instance);
                instance.users.forEach(user => {
                    io.to(ids[user]).emit('instance', instance);
                });
            }
        });
    });
});

console.log('listening on 4242');

const addOrRemoveEmoji = (name, emoji, list) => {
    if (typeof emoji === "string") {
        return;
    }
    let emojiObj;
    let index;
    list.forEach(obj => {
        if (emoji.colons === obj.emoji.colons) {
            emojiObj = obj;
            index = list.indexOf(emojiObj);
        }
    });
    if (emojiObj) {
        if (emojiObj.names.includes(name)) {
            emojiObj.names.splice(emojiObj.names.indexOf(name), 1);
            if (emojiObj.names.length === 0) {
                list.splice(index, 1);
            }
        } else {
            emojiObj.names.push(name);
        }
    } else {
        list.push({
            names: [ name ],
            emoji
        });
    }
};

const removeVotesFromStatement = (instance, statement, isComment = false) => {
    statement.ups.forEach(name => instance.votes[name]++);
    statement.downs.forEach(name => instance.votes[name]++);
    if (!isComment) {
        statement.comments.forEach(comment => {
            comment.ups.forEach(name => instance.votes[name]++);
            comment.downs.forEach(name => instance.votes[name]++);
        });
    }
};

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

const getComment = (statement, id) => {
    let comment;
    statement.comments.forEach(c => {
        if (c.id === id) {
            comment = c;
        }
    });
    return comment;
};

const id = () => 'id-' + (Math.random()*0xFFFFFF<<0).toString(16);
