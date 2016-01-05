// express
var express = require('express');
var app = express();

// request logging
var morgan = require('morgan');
app.use(morgan('short'));

// compress responses
var compression = require('compression');
app.use(compression());

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

// enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use(function(req, res, next) {
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
    next();
  });
}

//////////////////////////////////////////////////////////////////////////
// Web endpoints                                                        //
//////////////////////////////////////////////////////////////////////////

// landing page
app.get('/', function(req, res) {
  res.render('index.garnet');
});

var server = app.listen(process.env.PORT || 3000, function() {
  console.log('Listening on port %d.', server.address().port);
});
