# NextMU Docker for Essential Services

## Installation
First download and install Docker and Node.js, after you finish follow the [Script](#script) section instructions.

### Docker Desktop
#### Windows
```https://docs.docker.com/desktop/install/windows-install/```

#### Linux
```https://docs.docker.com/desktop/install/linux-install/```

#### MacOS
```https://docs.docker.com/desktop/install/mac-install/```

### Node.js
Install Node.js v16.x or newer.

```https://nodejs.org/en```

## Script
After you installed Docker and Node.js run the compatible script and it will generate the environment files for each service, initialize the docker instances and configure Zitadel.
After it finish everything you can find your Zitadel Admin credentials in `./script-output/portal/config.json`, also you will find the required configuration for a manual setup of the Remix website (`https://github.com/kuncarous/nextmu-remix`)

#### Windows
```
./script.bat
```

#### Linux / MacOS
```
chmod 777 script.sh
./script.sh
```