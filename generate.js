var fs = require('fs');
var glob = require('glob');
var path = require('path');
var jsdom = require('jsdom');
var Q = require('q');

var jsdomenv = Q.denodeify(jsdom.env);
var glob = Q.denodeify(glob);

var reference = 'http://threejs.org/docs/#Reference/';

//

var typesMap = {
  'Integer': 'number',
  'Number': 'number',
  'Float': 'number',
  'Array': 'array',
  'Boolean': 'boolean',
  'String': 'string',
  'Function': 'function',
  'Object': 'object'
};

function mapType(type) {
  return typesMap[type] || type;
}

function parameters(str) {
  var parameterRegex = /(?:\[page:([\w\.]+)\s+([\w\.]+)\])|(?:([\w\.]+)\s*[\),])/gi;

  var parameter, parameters = [];
  while ((match = parameterRegex.exec(str)) !== null) {
    parameters.push({
      name: match[2] || match[3],
      type: mapType(match[1])
    });
  }

  return parameters;
}

function funcDefintion(parameters, type) {
  var definition = 'fn(';
  parameters.forEach(function(parameter, index) {
    definition += parameter.name;
    if (parameter.type) {
      definition += ': ' + parameter.type;
    }
    if (index + 1 !== parameters.length) {
      definition += ', ';
    }
  });
  definition += ')';

  if (type && type != 'null') {
    definition += ' -> ' + type;
  }

  return definition;
}

function constructorDefinition(str) {
  var params = parameters(str);
  return funcDefintion(params, null);
}

function methodDefinition(str) {
  var methodRegex = /\[method:([\w]+) ([\w\.\s]+)\]/gi;
  var match = methodRegex.exec(str);

  var name = match[2];
  var type = mapType(match[1]);
  var params = parameters(str);

  return {
    name: name,
    definition: funcDefintion(params, type)
  };
}

function objectDefinition(filename) {
  var prototypeRegex = /\[page:([\w\.]+)\]/gi;
  var constructorRegex = /\[name\]\(\s*[\[page:\w+\s*\w*\],?\s*]*\s*\)/gi;
  var methodRegex = /\[method:([\w]+) ([\w\.\s]+)\]\(\s*[\[page:\w+\s*\w*\],?\s*]*\s*\)/gi;
  var propertyRegex = /\[property:([\w]+) ([\w\.\s]+)\]/gi;

  var html = fs.readFileSync(filename, 'utf8');

  var definition = {
    '!name': path.basename(filename, '.html'),
    '!url': reference + path.relative('three.js/docs/api', filename).split('.html')[0],
    'prototype': {}
  };

  var prototype = prototypeRegex.exec(html);
  if (prototype) {
    definition['prototype']['!proto'] = mapType(prototype[1]);
  }

  return jsdomenv(html)
    .then(function(window) {
      var document = window.document;
      var description = document.getElementsByClassName('desc')[0];
      if (description) {
        definition['!doc'] = description.innerHTML.trim();
      }

      var elements = document.getElementsByTagName('h3');
      for (var i = 0; i < elements.length; i+= 1) {
        var element = elements[i];
        var text = element.innerHTML;

        var constructor = constructorRegex.exec(text);
        var method = methodRegex.exec(text);
        var property = propertyRegex.exec(text);

        if (constructor) {
          definition['!type'] = constructorDefinition(constructor[0]);
        } else if (method || property) {
          var name, type, doc;
          var docElement, nextElement = element;
          while (true) {
            nextElement = nextElement.nextSibling;
            if (!nextElement) {
              break;
            } else if (nextElement.nodeName == '#text') {
              continue;
            } else if (nextElement.nodeName == 'DIV') {
              docElement = nextElement;
            } else {
              break;
            }
          }

          if (docElement) {
            doc = docElement.innerHTML.trim();
          }

          if (method) {
            method = methodDefinition(method[0]);
            name = method.name;
            type = method.definition;
          } else if (property) {
            name = property[2];
            type = mapType(property[1]);
          }

          if (doc) {
            definition['prototype'][name] = {
              '!type': type,
              '!doc': doc
            };
          } else {
            definition['prototype'][name] = type;
          }
        }
      };

      return definition;
    });
}

glob('three.js/docs/api/**/*.html')
  .then(function(files) {
    var defs = {
      '!name': 'threejs',
      'THREE': {}
    };

    var promises = files.map(function(filename) {
      return objectDefinition(filename)
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
    console.log(error.stack);
  });;
