# NextMU Docker for Essential Services

## Installation
First download and install Docker, after you installed Docker you can use `docker-compose up -d` command and it will start all the essential services.
After all services are running you need to run `zitadel-script`, follow [Script](#script) section instructions.

### Desktop Mode
#### Windows
```https://docs.docker.com/desktop/install/windows-install/```

#### Linux
```https://docs.docker.com/desktop/install/linux-install/```

#### MacOS
```https://docs.docker.com/desktop/install/mac-install/```

## Script
Be sure you have Node.js installed (at least Node.js 16.x or newer), go to `zitadel-script` and run `npm install`, after finish the packages installations you can run `npm run start`, wait it to finish and it will generate the `output.json` file which contains all the required information including the admin credentials with the initial password to access Zitadel (you can access it through http://localhost:8080 url).

If you want you can just run the following commands:
#### Windows
```
./script.bat
```

#### Linux / MacOS
```
chmod 777 script.sh
./script.sh
```