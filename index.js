// express
var express = require('express');
var app = express();

// socket.io
var http = require('http').Server(app);
var io = require('socket.io')(http);

// lodash
var lodash = require('lodash');

// request logging
var morgan = require('morgan');
app.use(morgan('short'));

// compress responses
var compression = require('compression');
app.use(compression());

// parse request bodies
var bodyParser = require('body-parser');
app.use(bodyParser.json({ type: '*/*' }));

// turn off unnecessary header
app.disable('x-powered-by');

// turn on strict routing
app.enable('strict routing');

// use the X-Forwarded-* headers
app.enable('trust proxy');

// template engine
app.set('view engine', 'garnet');

// favicon
var favicon = require('serve-favicon');
var path = require('path');
app.use(favicon(path.join(__dirname, 'static/favicon.ico')));

// add CORS headers
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

// generate UUIDs
var uuid = require('node-uuid');

function makeId() {
  return uuid.v4().replace(/-/g, '').substr(16);
}

//////////////////////////////////////////////////////////////////////////
// State                                                                //
//////////////////////////////////////////////////////////////////////////

// in-memory store of all the sessions
// the keys are the session IDs (strings)
// the values have the form: {
//   id: '84dba68dcea2952c',             // 8 random octets
//   lastActivity: new Date(),           // used to find old sessions to vacuum (only used in legacy API)
//   lastKnownTime: 123,                 // milliseconds from the start of the video
//   lastKnownTimeUpdatedAt: new Date(), // when we last received a time update
//   state: 'playing' | 'paused',        // whether the video is playing or paused
//   userIds: ['9a3078cd522cc3ff', ...]  // ids of the users in the session
//   videoId: 123                        // Netflix id the video
// }
var sessions = {};

// in-memory store of all the users
// the keys are the user IDs (strings)
// the values have the form: {
//   id: '9a3078cd522cc3ff',        // 8 random octets
//   sessionId: '84dba68dcea2952c', // id of the session, if one is joined
//   socket: <websocket>            // the websocket
// }
var users = {};

// vacuum old sessions (from legacy API)
setInterval(function() {
  console.log('Vacuuming old sessions...');
  var oldSessionIds = [];
  for (var sessionId in sessions) {
    if (sessions.hasOwnProperty(sessionId)) {
      var expiresAt = new Date();
      expiresAt.setTime(sessions[sessionId].lastActivity.getTime() + 1000 * 60 * 60);
      if (expiresAt < new Date() && sessions[sessionId].userIds.length === 0) {
        oldSessionIds.push(sessionId);
      }
    }
  }
  for (var i = 0; i < oldSessionIds.length; i++) {
    console.log('Deleting session ' + oldSessionIds[i] + '...');
    delete sessions[oldSessionIds[i]];
  }
  console.log('Done vacuuming.');
  console.log('Total sessions: ' + String(Object.keys(sessions).length));
}, 1000 * 60 * 60);

//////////////////////////////////////////////////////////////////////////
// Web endpoints                                                        //
//////////////////////////////////////////////////////////////////////////

// landing page
app.get('/', function(req, res) {
  // enforce HTTPS in production
  // right now we only enforce HTTPS for web endpoints.
  // we don't use HTTPS (WSS) for websockets because CloudFlare (our CDN) only
  // supports websockets for "enterprise" customers. so for now we use HTTP
  // (WS) for websockets and bypass CloudFlare.
  if (process.env.NODE_ENV === 'production') {
    var protocol = req.protocol.toLowerCase();

    // check for protocol from CloudFlare
    if (req.headers['Cf-Visitor'] || req.headers['cf-visitor']) {
      var visitor = JSON.parse(req.headers['Cf-Visitor'] || req.headers['cf-visitor']);
      if (visitor['scheme']) {
        protocol = visitor['scheme'].toLowerCase();
      }
    }

    if (protocol !== 'https') {
      res.redirect(301, 'https://' + req.hostname + req.url);
      return;
    }
  }

  res.render('index.garnet');
});

//////////////////////////////////////////////////////////////////////////
// Legacy API                                                           //
//////////////////////////////////////////////////////////////////////////

// POST /sessions/create
// request {
//   videoId: 123
// }
// response {
//   id: '84dba68dcea2952c',
//   lastActivity: new Date(),
//   lastKnownTime: 123,
//   lastKnownTimeUpdatedAt: new Date(),
//   state: 'playing' | 'paused',
//   videoId: 123
// }
app.post('/sessions/create', function(req, res) {
  // validate the input
  if (typeof req.body.videoId === 'undefined') {
    res.status(500).send('Missing parameter: videoId');
    return;
  }
  if (typeof req.body.videoId !== 'number' || req.body.videoId % 1 !== 0) {
    res.status(500).send('Invalid parameter: videoId');
    return;
  }

  // create the session
  var now = new Date();
  var session = {
    id: makeId(),
    lastActivity: now,
    lastKnownTime: 0,
    lastKnownTimeUpdatedAt: now,
    state: 'paused',
    userIds: [],
    videoId: req.body.videoId
  };
  sessions[session.id] = session;

  // response
  res.json(session);
});

// POST /sessions/:id/update
// request {
//   lastKnownTime: 123,
//   state: 'playing' | 'paused'
// }
// response {
//   id: '84dba68dcea2952c',
//   lastActivity: new Date(),
//   lastKnownTime: 123,
//   lastKnownTimeUpdatedAt: new Date(),
//   state: 'playing' | 'paused',
//   videoId: 123
// }
app.post('/sessions/:id/update', function(req, res) {
  // validate the input
  var sessionId = req.params.id;
  if (!sessions.hasOwnProperty(sessionId)) {
    res.status(404).send('Unknown session id: ' + sessionId);
    return;
  }
  if (typeof req.body.lastKnownTime === 'undefined') {
    res.status(500).send('Missing parameter: lastKnownTime');
    return;
  }
  if (typeof req.body.lastKnownTime !== 'number' || req.body.lastKnownTime % 1 !== 0) {
    res.status(500).send('Invalid parameter: lastKnownTime');
    return;
  }
  if (req.body.lastKnownTime < 0) {
    res.status(500).send('Invalid parameter: lastKnownTime');
    return;
  }
  if (typeof req.body.state === 'undefined') {
    res.status(500).send('Missing parameter: state');
    return;
  }
  if (typeof req.body.state !== 'string') {
    res.status(500).send('Invalid parameter: state');
    return;
  }
  if (req.body.state !== 'playing' && req.body.state !== 'paused') {
    res.status(500).send('Invalid parameter: state');
    return;
  }

  // update the session
  var now = new Date();
  sessions[sessionId].lastActivity = now;
  sessions[sessionId].lastKnownTime = req.body.lastKnownTime;
  sessions[sessionId].lastKnownTimeUpdatedAt = now;
  sessions[sessionId].state = req.body.state;

  // response
  res.json(sessions[sessionId]);
});

// GET /sessions/:id
// response {
//   id: '84dba68dcea2952c',
//   lastActivity: new Date(),
//   lastKnownTime: 123,
//   lastKnownTimeUpdatedAt: new Date(),
//   state: 'playing' | 'paused',
//   videoId: 123
// }
app.get('/sessions/:id', function(req, res) {
  // validate the input
  var sessionId = req.params.id;
  if (!sessions.hasOwnProperty(sessionId)) {
    res.status(404).send('Unknown session id: ' + sessionId);
    return;
  }

  // pet the watchdog
  sessions[sessionId].lastActivity = new Date();

  // response
  res.json(sessions[sessionId]);
});

//////////////////////////////////////////////////////////////////////////
// Websockets API                                                       //
//////////////////////////////////////////////////////////////////////////

io.on('connection', function(socket) {
  var userId = makeId();
  users[userId] = {
    id: userId,
    sessionId: null,
    socket: socket
  };
  socket.emit('userId', userId);
  console.log('User ' + userId + ' connected.');

  socket.on('reboot', function(data, fn) {
    if (typeof data.sessionId !== 'string' || data.sessionId.length !== 16) {
      fn({ errorMessage: 'Invalid session ID.' });
      console.log('User ' + userId + ' attempted to reboot invalid session ' + String(data.sessionId) + '.');
      return;
    }

    if (typeof data.lastKnownTime !== 'number' || data.lastKnownTime % 1 !== 0 || data.lastKnownTime < 0) {
      fn({ errorMessage: 'Invalid lastKnownTime.' });
      console.log('User ' + userId + ' attempted to reboot session ' + data.sessionId + ' with invalid lastKnownTime ' + String(data.lastKnownTime) + '.');
      return;
    }

    if (typeof data.lastKnownTimeUpdatedAt !== 'number' || data.lastKnownTimeUpdatedAt % 1 !== 0 || data.lastKnownTimeUpdatedAt < 0) {
      fn({ errorMessage: 'Invalid lastKnownTimeUpdatedAt.' });
      console.log('User ' + userId + ' attempted to reboot session ' + data.sessionId + ' with invalid lastKnownTimeUpdatedAt ' + String(data.lastKnownTimeUpdatedAt) + '.');
      return;
    }

    if (typeof data.state !== 'string' || (data.state !== 'playing' && data.state !== 'paused')) {
      fn({ errorMessage: 'Invalid state.' });
      console.log('User ' + userId + ' attempted to reboot session ' + data.sessionId + ' with invalid state ' + String(data.state) + '.');
      return;
    }

    if (typeof data.videoId !== 'number' || data.videoId % 1 !== 0 || data.videoId < 0) {
      fn({ errorMessage: 'Invalid video ID.' });
      console.log('User ' + userId + ' attempted to reboot session with invalid video ' + String(data.videoId) + '.');
      return;
    }

    if (sessions.hasOwnProperty(data.sessionId)) {
      sessions[data.sessionId].userIds.push(userId);
      users[userId].sessionId = data.sessionId;
      console.log('User ' + userId + ' reconnected and rejoined session ' + users[userId].sessionId + '.');
    } else {
      var session = {
        id: data.sessionId,
        lastActivity: new Date(), // deprecated
        lastKnownTime: data.lastKnownTime,
        lastKnownTimeUpdatedAt: new Date(data.lastKnownTimeUpdatedAt),
        state: data.state,
        videoId: data.videoId,
        userIds: [userId]
      };
      sessions[session.id] = session;
      users[userId].sessionId = data.sessionId;
      console.log('User ' + userId + ' rebooted session ' + users[userId].sessionId + ' with video ' + String(data.videoId) + ', time ' + String(data.lastKnownTime) + ', and state ' + data.state + ' for epoch ' + String(data.lastKnownTimeUpdatedAt) + '.');
    }

    fn({
      lastKnownTime: sessions[data.sessionId].lastKnownTime,
      lastKnownTimeUpdatedAt: sessions[data.sessionId].lastKnownTimeUpdatedAt.getTime(),
      state: sessions[data.sessionId].state
    });
  });

  socket.on('createSession', function(videoId, fn) {
    if (typeof videoId !== 'number' || videoId % 1 !== 0 || videoId < 0) {
      fn({ errorMessage: 'Invalid video ID.' });
      console.log('User ' + userId + ' attempted to create session with invalid video ' + String(videoId) + '.');
      return;
    }

    users[userId].sessionId = makeId();
    var now = new Date();
    var session = {
      id: users[userId].sessionId,
      lastActivity: now, // deprecated
      lastKnownTime: 0,
      lastKnownTimeUpdatedAt: now,
      state: 'paused',
      userIds: [userId],
      videoId: videoId
    };
    sessions[session.id] = session;

    fn({
      lastKnownTime: sessions[users[userId].sessionId].lastKnownTime,
      lastKnownTimeUpdatedAt: sessions[users[userId].sessionId].lastKnownTimeUpdatedAt.getTime(),
      sessionId: users[userId].sessionId,
      state: sessions[users[userId].sessionId].state
    });
    console.log('User ' + userId + ' created session ' + users[userId].sessionId + ' with video ' + String(videoId) + '.');
  });

  socket.on('joinSession', function(sessionId, fn) {
    if (typeof sessionId !== 'string' || !sessions.hasOwnProperty(sessionId)) {
      fn({ errorMessage: 'Invalid session ID.' });
      console.log('User ' + userId + ' attempted to join nonexistent session ' + String(sessionId) + '.');
      return;
    }

    if (users[userId].sessionId !== null) {
      fn({ errorMessage: 'Already in a session.' });
      console.log('User ' + userId + ' attempted to join session ' + sessionId + ', but the user is already in session ' + users[userId].sessionId + '.');
      return;
    }

    users[userId].sessionId = sessionId;
    sessions[sessionId].userIds.push(userId);

    fn({
      videoId: sessions[sessionId].videoId,
      lastKnownTime: sessions[sessionId].lastKnownTime,
      lastKnownTimeUpdatedAt: sessions[sessionId].lastKnownTimeUpdatedAt.getTime(),
      state: sessions[sessionId].state
    });
    console.log('User ' + userId + ' joined session ' + sessionId + '.');
  });

  socket.on('leaveSession', function(_, fn) {
    if (users[userId].sessionId === null) {
      fn({ errorMessage: 'Not in a session.' });
      console.log('User ' + userId + ' attempted to leave a session, but the user was not in one.');
      return;
    }

    var sessionId = users[userId].sessionId;
    lodash.pull(sessions[sessionId].userIds, userId);
    users[userId].sessionId = null;

    fn(null);
    console.log('User ' + userId + ' left session ' + sessionId + '.');

    if (sessions[sessionId].userIds.length === 0) {
      delete sessions[sessionId];
      console.log('Session ' + sessionId + ' was deleted because there were no more users in it.');
    }
  });

  socket.on('updateSession', function(data, fn) {
    if (users[userId].sessionId === null) {
      fn({ errorMessage: 'Not in a session.' });
      console.log('User ' + userId + ' attempted to update a session, but the user was not in one.');
      return;
    }

    if (typeof data.lastKnownTime !== 'number' || data.lastKnownTime % 1 !== 0 || data.lastKnownTime < 0) {
      fn({ errorMessage: 'Invalid lastKnownTime.' });
      console.log('User ' + userId + ' attempted to update session ' + users[userId].sessionId + ' with invalid lastKnownTime ' + String(data.lastKnownTime) + '.');
      return;
    }

    if (typeof data.lastKnownTimeUpdatedAt !== 'number' || data.lastKnownTimeUpdatedAt % 1 !== 0 || data.lastKnownTimeUpdatedAt < 0) {
      fn({ errorMessage: 'Invalid lastKnownTimeUpdatedAt.' });
      console.log('User ' + userId + ' attempted to update session ' + users[userId].sessionId + ' with invalid lastKnownTimeUpdatedAt ' + String(data.lastKnownTimeUpdatedAt) + '.');
      return;
    }

    if (typeof data.state !== 'string' || (data.state !== 'playing' && data.state !== 'paused')) {
      fn({ errorMessage: 'Invalid state.' });
      console.log('User ' + userId + ' attempted to update session ' + users[userId].sessionId + ' with invalid state ' + String(data.state) + '.');
      return;
    }

    sessions[users[userId].sessionId].lastActivity = new Date(); // deprecated
    sessions[users[userId].sessionId].lastKnownTime = data.lastKnownTime;
    sessions[users[userId].sessionId].lastKnownTimeUpdatedAt = new Date(data.lastKnownTimeUpdatedAt);
    sessions[users[userId].sessionId].state = data.state;

    fn();
    console.log('User ' + userId + ' updated session ' + users[userId].sessionId + ' with time ' + String(data.lastKnownTime) + ' and state ' + data.state + ' for epoch ' + String(data.lastKnownTimeUpdatedAt) + '.');

    lodash.forEach(sessions[users[userId].sessionId].userIds, function(id) {
      if (id !== userId) {
        console.log('Sending update to user ' + id + '.');
        users[id].socket.emit('update', {
          lastKnownTime: sessions[users[userId].sessionId].lastKnownTime,
          lastKnownTimeUpdatedAt: sessions[users[userId].sessionId].lastKnownTimeUpdatedAt.getTime(),
          state: sessions[users[userId].sessionId].state
        });
      }
    });
  });

  socket.on('ping', function(data, fn) {
    fn((new Date()).getTime());
    console.log('User ' + userId + ' pinged.');
  });

  socket.on('disconnect', function() {
    var sessionId = users[userId].sessionId;
    if (sessionId !== null) {
      lodash.pull(sessions[sessionId].userIds, userId);
      users[userId].sessionId = null;

      console.log('User ' + userId + ' left session ' + sessionId + '.');

      if (sessions[sessionId].userIds.length === 0) {
        delete sessions[sessionId];
        console.log('Session ' + sessionId + ' was deleted because there were no more users in it.');
      }
    }

    delete users[userId];
    console.log('User ' + userId + ' disconnected.');
  });
});

var server = http.listen(process.env.PORT || 3000, function() {
  console.log('Listening on port %d.', server.address().port);
});
