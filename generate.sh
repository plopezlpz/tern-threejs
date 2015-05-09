#!/bin/bash
if [ ! -d "./three.js" ]; then
    git clone git@github.com:mrdoob/three.js.git
fi
node generate.js
