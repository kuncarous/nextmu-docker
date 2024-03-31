#!/bin/bash
if ! command -v docker-compose --version &> /dev/null
then
    echo "docker-compose not found, install docker first."
    exit 1
fi

if ! command -v npm --version &> /dev/null
then
    echo "npm wasn't found, install node.js first."
    exit 1
fi

(
    cd script &&
    npm install &&
    RUN_MODE=init npm run start
)
(
    docker-compose up -d
)
(
    cd script &&
    npm install &&
    RUN_MODE=zitadel npm run start
)