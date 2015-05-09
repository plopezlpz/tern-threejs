var fs = require('fs');
var glob = require('glob');
var path = require('path');
var jsdom = require('jsdom');
var Q = require('q');

var jsdomenv = Q.denodeify(jsdom.env);
var glob = Q.denodeify(glob);

var reference = 'http://threejs.org/docs/#Reference/';
var page = /\[page:([\w\.]+)\]/gi;
var constructor = /\[name\]\(\s*[\[page:\w+\s*\w*\],?\s*]*\s*\)/gi;
var property = /\[(?:member|property|method):([\w]+) ([\w\.\s]+)\]/gi;

function func(str) {
  var self = {};
  var match;
  self.parameters = [];

  //
  var parameterRegex = /(?:\[page:([\w\.]+)\s+([\w\.]+)\])|(?:([\w\.]+)\s*[\),])/gi;
  while ((match = parameterRegex.exec(str)) !== null) {
    self.parameters.push({
      name: match[2] || match[3],
      type: match[1]
    });
  }

  //
  self.def = 'fn(';
  self.parameters.forEach(function(parameter, index) {
    self.def += parameter.name;
    if (parameter.type) {
      self.def += ':' + parameter.type;
    }
    if (index + 1 !== self.parameters.length) {
      self.def += ', ';
    }
  });
  self.def += ')';
  if (self.returnType) {
    self.def += ' -> ' + self.returnType;
  }

  return self;
}

function object(filename) {
  var name = path.basename(filename, '.html');
  var hash = path.relative('three.js/docs/api', filename).split('.html')[0];
  var url = reference + hash;
  var html = fs.readFileSync(filename, 'utf8');

  var proto = page.exec(html);
  var proto = proto ? proto[1] : null;

  var con = constructor.exec(html);
  if (con) {
    con = func(con[0]);
  }

  return jsdomenv(html)
    .then(function(window) {
      var def = {
        '!name': name,
        '!url': url
      };

      var document = window.document;
      var description = document.getElementsByClassName('desc')[0];
      if (description) {
        def['!doc'] = description.innerHTML.trim();
      }

      if (con) {
        def['!type'] = con.def;
      }
      def['prototype'] = {};
      if (proto) {
        def['prototype']['!proto'] = proto;
      }

      return def;
    });
}

glob('three.js/docs/api/**/*.html')
  .then(function(files) {
    var defs = {
      '!name': 'threejs',
      'THREE': {}
    };

    var promises = files.map(function(filename) {
      return object(filename)
        .then(function(def) {
          var name = def['!name'];
          defs['THREE'][name] = def;
        })
    });

    return Q.all(promises)
      .then(function() {
        console.log(JSON.stringify(defs, null, 2));
      });
  }).fail(function(error) {
    console.log(error);
  });;
