var fs = require('fs');
var glob = require('glob');
var path = require('path');
var jsdom = require('jsdom');
var Q = require('q');

var jsdomenv = Q.denodeify(jsdom.env);
var glob = Q.denodeify(glob);

//

var ThreeJSDocumentionBasePath = 'http://threejs.org/docs/#Reference/';
var JSONTypeDefinitionFilename = 'threejs.json';
var TernPluginFilename = 'threejs.js';

function TernPluginTemplate(json) {
  return `(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    return mod(require("tern/lib/infer"), require("tern/lib/tern"));
  if (typeof define == "function" && define.amd) // AMD
    return define([ "tern/lib/infer", "tern/lib/tern" ], mod);
  mod(tern, tern);
})(function(infer, tern) {
  "use strict";

  tern.registerPlugin("threejs", function(server, options) {
    return {
      defs : ${json}
    };
  });
});`;
}

//

var typesMap = {
  'Integer': 'number',
  'Number': 'number',
  'Float': 'number',
  'Array': '[]',
  'Boolean': 'bool',
  'String': 'string',
  'Function': 'function',
  'Object': 'object'
};

function ThreeJSType(type) {
  return typesMap[type] || type;
}

function defineThreeJSType(type) {
  typesMap[type] = `+THREE.${type}`;
}

function ThreeJSPrototype(type) {
  return `${type}`;
}

//

function parameters(str) {
  var parameterRegex = /(?:\[page:([\w\.]+)\s+([\w\.]+)\])|(?:([\w\.]+)\s*[\),])/gi;

  var parameter, parameters = [];
  while ((match = parameterRegex.exec(str)) !== null) {
    parameters.push({
      name: match[2] || match[3],
      type: ThreeJSType(match[1])
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
  var type = ThreeJSType(match[1]);
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
    '!url': ThreeJSDocumentionBasePath + path.relative('three.js/docs/api', filename).split('.html')[0],
    'prototype': {}
  };

  var prototype = prototypeRegex.exec(html);
  if (prototype) {
    definition['prototype']['!proto'] = ThreeJSPrototype(prototype[1]);
  }

  return jsdomenv(html)
    .then(function(window) {
      var document = window.document;
      var description = document.getElementsByClassName('desc')[0];
      if (description) {
        definition['!doc'] = description.innerHTML.trim();
      }

      var elements = document.getElementsByTagName('h3');
      for (var i = 0; i < elements.length; i += 1) {
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
            type = ThreeJSType(property[1]);
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

    files.forEach(function(filename) {
      var typename = path.basename(filename, '.html');
      defineThreeJSType(typename);
    });

    var promises = files.map(function(filename) {
      return objectDefinition(filename)
        .then(function(def) {
          var typename = path.basename(filename, '.html');
          defs['THREE'][typename] = def;
        })
    });

    return Q.all(promises)
      .then(function() {
        var json = JSON.stringify(defs, null, 2);

        fs.writeFile(JSONTypeDefinitionFilename, json, function(err) {
          if (err) throw err;

          console.log(`generated ${JSONTypeDefinitionFilename}`);
        });

        fs.writeFile(TernPluginFilename, TernPluginTemplate(json), function(err) {
          if (err) throw err;

          console.log(`generated ${TernPluginFilename}`);
        });
      });
  }).fail(function(error) {
    console.log(error.stack);
  });;
