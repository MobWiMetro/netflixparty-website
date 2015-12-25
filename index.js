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
app.use(bodyParser.urlencoded({
  extended: true
}));

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
app.use(favicon(__dirname + '/static/favicon.ico'));

app.get('/', function(req, res) {
  res.render('index.garnet');
});

var server = app.listen(process.env.PORT || 3000, function() {
  console.log('Listening on port %d.', server.address().port);
});
