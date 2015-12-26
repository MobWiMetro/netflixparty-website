var express = require('express');
var app = express();

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

// generate UUIDs for sessions
var uuid = require('node-uuid');

// in-memory store of all the sessions
// the keys are the session IDs (strings)
// the values have the form {
//   id: '110ec58a-a0f2-4ac4-8393-c866d813b8d1',
//   lastActivity: new Date(),
//   lastKnownTime: 123,
//   lastKnownTimeUpdatedAt: new Date(),
//   state: 'playing' | 'paused',
//   videoId: 123
// }
var sessions = {};

// vacuum old sessions
setInterval(function() {
  console.log('Vacuuming old sessions...');
  var oldSessionIds = [];
  for (var sessionId in sessions) {
    if (sessions.hasOwnProperty(sessionId)) {
      var expiresAt = new Date();
      expiresAt.setTime(sessions[sessionId].lastActivity.getTime() + 1000 * 60 * 60);
      if (expiresAt < new Date()) {
        oldSessionIds.push(sessionId);
      }
    }
  }
  for (var i = 0; i < oldSessionIds.length; i++) {
    console.log('Deleting session ' + oldSessionIds[i] + '...');
    delete sessions[oldSessionIds[i]];
  }
  console.log('Done vacuuming.')
  console.log('Total sessions: ' + String(Object.keys(sessions).length));
}, 1000 * 60 * 60);

// landing page
app.get('/', function(req, res) {
  res.render('index.garnet');
});

// POST /sessions/create
// request {
//   videoId: 123
// }
// response {
//   id: '110ec58a-a0f2-4ac4-8393-c866d813b8d1',
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
    id: uuid.v4(),
    lastActivity: now,
    lastKnownTime: 0,
    lastKnownTimeUpdatedAt: now,
    state: 'paused',
    videoId: req.body.videoId
  };
  sessions[session.id] = session;

  // response
  res.json(session);
});

// POST /sessions/:id/update
// request {
//   id: '110ec58a-a0f2-4ac4-8393-c866d813b8d1',
//   lastKnownTime: 123,
//   state: 'playing' | 'paused'
// }
// response {
//   id: '110ec58a-a0f2-4ac4-8393-c866d813b8d1',
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
  sessions[sessionId].lastKnownTime = req.body.lastKnownTime;
  sessions[sessionId].state = req.body.state;

  // response
  res.json(sessions[sessionId]);
});

// GET /sessions/:id
// response {
//   id: '110ec58a-a0f2-4ac4-8393-c866d813b8d1',
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

  // response
  res.json(sessions[sessionId]);
});

var server = app.listen(process.env.PORT || 3000, function() {
  console.log('Listening on port %d.', server.address().port);
});
