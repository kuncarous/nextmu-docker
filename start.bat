@echo off

ECHO Checking if docker and node.js is installed
ECHO.

WHERE docker-compose
IF %ERRORLEVEL% NEQ 0 ECHO docker-compose not found, install docker first.

ECHO.
ECHO Docker is installed
ECHO.

WHERE npm
IF %ERRORLEVEL% NEQ 0 ECHO npm wasn't found, install node.js first.

ECHO.
ECHO Node.js is installed
ECHO Running commands

set RUN_MODE=init
pushd script
call npm install
call npm run start
popd

call docker-compose up -d

set RUN_MODE=zitadel
pushd script
call npm run start
popd