import { createServiceAccountInterceptor, createManagementClient, ManagementServiceClient, createAdminClient, AdminServiceClient } from "@zitadel/node/api";
import { ServiceAccount } from "@zitadel/node/credentials";
import { Metadata } from "nice-grpc-common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:url";
import path from "node:path";
import axios from "axios";
import { randomBytes } from "node:crypto";

// Enums (since can't be imported in linux)
enum OIDCResponseType {
    OIDC_RESPONSE_TYPE_CODE = 0,
    OIDC_RESPONSE_TYPE_ID_TOKEN = 1,
    OIDC_RESPONSE_TYPE_ID_TOKEN_TOKEN = 2,
    UNRECOGNIZED = -1
}
enum OIDCGrantType {
    OIDC_GRANT_TYPE_AUTHORIZATION_CODE = 0,
    OIDC_GRANT_TYPE_IMPLICIT = 1,
    OIDC_GRANT_TYPE_REFRESH_TOKEN = 2,
    OIDC_GRANT_TYPE_DEVICE_CODE = 3,
    UNRECOGNIZED = -1
}
enum OIDCAppType {
    OIDC_APP_TYPE_WEB = 0,
    OIDC_APP_TYPE_USER_AGENT = 1,
    OIDC_APP_TYPE_NATIVE = 2,
    UNRECOGNIZED = -1
}
enum OIDCAuthMethodType {
    OIDC_AUTH_METHOD_TYPE_BASIC = 0,
    OIDC_AUTH_METHOD_TYPE_POST = 1,
    OIDC_AUTH_METHOD_TYPE_NONE = 2,
    OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT = 3,
    UNRECOGNIZED = -1
}
enum OIDCVersion {
    OIDC_VERSION_1_0 = 0,
    UNRECOGNIZED = -1
}
enum OIDCTokenType {
    OIDC_TOKEN_TYPE_BEARER = 0,
    OIDC_TOKEN_TYPE_JWT = 1,
    UNRECOGNIZED = -1
}

enum APIAuthMethodType {
    API_AUTH_METHOD_TYPE_BASIC = 0,
    API_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT = 1,
    UNRECOGNIZED = -1
}

// Script
const api = process.env.ZITADEL_URL || 'http://localhost:8080';
const audience = process.env.ZITADEL_AUDIENCE || 'http://localhost:8080';
const username = process.env.ZITADEL_ADMIN_USERNAME || 'admin';
const password = process.env.ZITADEL_ADMIN_PASSWORD || 'Admin1!@#';
const initOutputDir = '../environments/';
const zitadelOutputDir = '../script-output/';

console.log(`API : ${api}`);
console.log(`Audience : ${audience}`);

function createServiceAccount(): ServiceAccount
{
    const json = readFileSync('../zitadel-machinekey/zitadel-admin-sa.json');
    return ServiceAccount.fromJsonString(json.toString());
}

async function createOrFindUser(managementClient: ManagementServiceClient, username: string)
{
    const listResponse = await managementClient.listUsers({});
    const user = listResponse.result.find(v => v.userName === username);
    if (user != null) return user.id;
    const response = await managementClient.addHumanUser(
        {
            userName: username,
            initialPassword: password,
            profile: {
                firstName: 'Server',
                lastName: 'Owner',
                nickName: 'Admin',
                displayName: 'Admin',
                preferredLanguage: 'en',
            },
            email: {
                email: "admin@localhost.com",
                isEmailVerified: true
            }
        }
    );
    return response.userId;
}

async function addUserIdToIAMMembers(managementClient: ManagementServiceClient, adminClient: AdminServiceClient, userId: string)
{
    const listMembers = await adminClient.listIAMMembers({ queries: [ { userIdQuery: { userId } } ]});
    if (listMembers.result.length > 0) return;
    await adminClient.addIAMMember({ userId, roles: ['IAM_OWNER'] });
}

async function createOrFindAdminUser(managementClient: ManagementServiceClient, adminClient: AdminServiceClient)
{
    const userId = await createOrFindUser(managementClient, username);
    await addUserIdToIAMMembers(managementClient, adminClient, userId);
    return userId;
}

async function createOrFindOrganization(managementClient: ManagementServiceClient, adminClient: AdminServiceClient)
{
    const listResponse = await adminClient.listOrgs({});
    const organization = listResponse.result.find(org => org.name === 'NextMU');
    if (organization != null) return organization.id;
    const response = await managementClient.addOrg({ name: 'NextMU' });
    return response.id;
}

async function configureLoginPolicy(managementClient: ManagementServiceClient, metadata: Metadata)
{
    const defaultLoginPolicy = await managementClient.getDefaultLoginPolicy({}, { metadata });
    const loginPolicy = await managementClient.getLoginPolicy({}, { metadata });
    if (loginPolicy.isDefault == false) return;
    await managementClient.addCustomLoginPolicy(
        {
            ...defaultLoginPolicy.policy,
            hidePasswordReset: false,
            allowDomainDiscovery: false,
            disableLoginWithPhone: true,
        },
        {
            metadata,
        }
    );
}

async function configureLabelPolicy(managementClient: ManagementServiceClient, metadata: Metadata)
{
    const defaultLabelPolicy = await managementClient.getDefaultLabelPolicy({}, { metadata });
    const LabelPolicy = await managementClient.getLabelPolicy({}, { metadata });
    if (LabelPolicy.isDefault == false) return;
    try {
        await managementClient.addCustomLabelPolicy(
            {
                ...defaultLabelPolicy.policy,
                hideLoginNameSuffix: true,
            },
            {
                metadata,
            }
        );
    } catch(e) {}
    await managementClient.activateCustomLabelPolicy({}, { metadata });
}

async function createOrFindProject(managementClient: ManagementServiceClient, metadata: Metadata)
{
    const listResponse = await managementClient.listProjects({}, { metadata });
    const project = listResponse.result.find(proj => proj.name === 'NextMU');
    if (project != null) return project.id;
    const response = await managementClient.addProject({ name: 'NextMU' }, { metadata });
    return response.id;
}

interface IProjectRole
{
    key: string;
    displayName: string;
    group: string;
}
const projectRoles: IProjectRole[] = [
    {
        key: 'update:view',
        displayName: 'Update Service (View)',
        group: 'Update Service'
    },
    {
        key: 'update:edit',
        displayName: 'Update Service (Edit)',
        group: 'Update Service'
    }
];

async function createProjectRoles(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listProjectRoles({ projectId }, { metadata });
    const rolesToAdd: IProjectRole[] = [];
    for (const role of projectRoles) {
        if (listResponse.result.find(r => r.key == role.key)) continue;
        rolesToAdd.push(role);
    }
    if (rolesToAdd.length == 0) return;
    await managementClient.bulkAddProjectRoles(
        {
            projectId,
            roles: rolesToAdd,
        },
        {
            metadata
        }
    );
}

async function createOrFindPortalApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({ projectId }, { metadata });
    const app = listResponse.result.find(proj => proj.name === 'Portal');
    if (app != null) return {
        appId: app.id,
        clientId: app.oidcConfig!.clientId,
    };
    const response = await managementClient.addOIDCApp(
        {
            projectId,
            name: 'Portal',
            redirectUris: ['http://localhost:5173/login/callback'],
            responseTypes: [OIDCResponseType.OIDC_RESPONSE_TYPE_CODE],
            grantTypes: [OIDCGrantType.OIDC_GRANT_TYPE_AUTHORIZATION_CODE, OIDCGrantType.OIDC_GRANT_TYPE_REFRESH_TOKEN],
            appType: OIDCAppType.OIDC_APP_TYPE_WEB,
            authMethodType: OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_NONE,
            postLogoutRedirectUris: ['http://localhost:5173/logout/callback'],
            version: OIDCVersion.OIDC_VERSION_1_0,
            devMode: true,
            accessTokenType: OIDCTokenType.OIDC_TOKEN_TYPE_BEARER,
            accessTokenRoleAssertion: false,
            idTokenRoleAssertion: false,
            idTokenUserinfoAssertion: false,
            clockSkew: {
                seconds: 1,
            },
            additionalOrigins: [],
            skipNativeAppSuccessPage: false,
        },
        { metadata }
    );
    return {
        appId: response.appId,
        clientId: response.clientId,
    };
}

async function createOrFindPortalApiApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({ projectId }, { metadata });
    const app = listResponse.result.find(proj => proj.name === 'Portal API');
    if (app != null) return {
        appId: app.id,
        clientId: app.apiConfig!.clientId,
    };
    const response = await managementClient.addAPIApp(
        {
            projectId,
            name: 'Portal API',
            authMethodType: APIAuthMethodType.API_AUTH_METHOD_TYPE_BASIC,
        },
        { metadata }
    );
    return {
        appId: response.appId,
        clientId: response.clientId,
        clientSecret: response.clientSecret,
    };
}

async function createOrFindGameApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({ projectId }, { metadata });
    const app = listResponse.result.find(proj => proj.name === 'Game');
    if (app != null) return {
        appId: app.id,
        clientId: app.oidcConfig!.clientId,
    };
    const response = await managementClient.addOIDCApp(
        {
            projectId,
            name: 'Game',
            redirectUris: ['http://127.0.0.1'],
            responseTypes: [OIDCResponseType.OIDC_RESPONSE_TYPE_CODE],
            grantTypes: [OIDCGrantType.OIDC_GRANT_TYPE_AUTHORIZATION_CODE, OIDCGrantType.OIDC_GRANT_TYPE_REFRESH_TOKEN],
            appType: OIDCAppType.OIDC_APP_TYPE_NATIVE,
            authMethodType: OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_NONE,
            postLogoutRedirectUris: ['http://127.0.0.1'],
            version: OIDCVersion.OIDC_VERSION_1_0,
            devMode: true,
            accessTokenType: OIDCTokenType.OIDC_TOKEN_TYPE_BEARER,
            accessTokenRoleAssertion: true,
            idTokenRoleAssertion: true,
            idTokenUserinfoAssertion: false,
            clockSkew: {
                seconds: 1,
            },
            additionalOrigins: [],
            skipNativeAppSuccessPage: true,
        },
        { metadata }
    );
    return {
        appId: response.appId,
        clientId: response.clientId,
    };
}

async function createOrFindUpdateApiApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({ projectId }, { metadata });
    const app = listResponse.result.find(proj => proj.name === 'Update API');
    if (app != null) return {
        appId: app.id,
        clientId: app.apiConfig!.clientId,
    };
    const response = await managementClient.addAPIApp(
        {
            projectId,
            name: 'Update API',
            authMethodType: APIAuthMethodType.API_AUTH_METHOD_TYPE_BASIC,
        },
        { metadata }
    );
    return {
        appId: response.appId,
        clientId: response.clientId,
        clientSecret: response.clientSecret,
    };
}

async function runZitadelScript()
{
    const serviceAccount = createServiceAccount();
    const serviceInterceptor = createServiceAccountInterceptor(audience, serviceAccount, { apiAccess: true });
    
    const managementClient = createManagementClient(api, serviceInterceptor);
    const adminClient = createAdminClient(api, serviceInterceptor);

    const userId = await createOrFindAdminUser(managementClient, adminClient);
    const organizationId = await createOrFindOrganization(managementClient, adminClient);
    
    const metadata = new Metadata();
    metadata.append('x-zitadel-orgid', organizationId);
    await configureLoginPolicy(managementClient, metadata);
    await configureLabelPolicy(managementClient, metadata);
    const projectId = await createOrFindProject(managementClient, metadata);
    await createProjectRoles(managementClient, projectId, metadata);
    const portalApp = await createOrFindPortalApplication(managementClient, projectId, metadata);
    const portalApi = await createOrFindPortalApiApplication(managementClient, projectId, metadata);
    const gameApp = await createOrFindGameApplication(managementClient, projectId, metadata);
    const updateApi = await createOrFindUpdateApiApplication(managementClient, projectId, metadata);

    try { mkdirSync(path.resolve(zitadelOutputDir, 'portal'), { recursive: true }); } catch(e) {}

    if (!!portalApi.clientSecret) {
        writeFileSync(
            path.resolve(zitadelOutputDir, 'portal/api-secret.json'),
            JSON.stringify(
                {
                    portalApi: {
                        clientId: portalApi.clientId,
                        clientSecret: portalApi.clientSecret,
                    },
                },
                undefined,
                '\t'
            )
        );
    }

    if (!!updateApi.clientSecret) {
        writeFileSync(
            path.resolve(zitadelOutputDir, 'portal/update-secret.json'),
            JSON.stringify(
                {
                    updateApi: {
                        clientId: updateApi.clientId,
                        clientSecret: updateApi.clientSecret,
                    },
                },
                undefined,
                '\t'
            )
        );
    }

    writeFileSync(
        path.resolve(zitadelOutputDir, 'portal/config.json'),
        JSON.stringify(
            {
                admin: {
                    username,
                    password,
                },
                additional_scopes: `urn:zitadel:iam:org:id:${organizationId} urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles`,
                projectId,
                portal: {
                    clientId: portalApp.clientId,
                },
                portalApi: {
                    clientId: portalApi.clientId,
                },
                game: {
                    clientId: gameApp.clientId,
                },
            },
            undefined,
            '\t'
        )
    );
}

interface IRedisEnv
{
    password?: string;
}

interface IMongoEnv
{
    username?: string;
    password?: string;
}

interface IPostgresEnv
{
    username?: string;
    password?: string;
}

interface IZitadelEnv
{
    masterKey?: string;
    postgres?: {
        username?: string;
        password?: string;
    };
}

let RedisEnv: IRedisEnv = {};
let MongoEnv: IMongoEnv = {};
let PostgresEnv: IPostgresEnv = {};
let ZitadelEnv: IZitadelEnv = {};

function generateRandomPassword(length: number = 32, characters: string = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!')
{
    return Array.from(crypto.getRandomValues(new Uint32Array(length)))
        .map((x) => characters[x % characters.length])
        .join('');
}

async function generateRedisEnvironment()
{
    const jsonPath = path.resolve(initOutputDir, 'redis.json');
    const envPath = path.resolve(initOutputDir, 'redis.env');

    if (existsSync(jsonPath)) {
        RedisEnv = JSON.parse(readFileSync(jsonPath).toString());
    }

    if (!RedisEnv.password) {
        RedisEnv.password = generateRandomPassword();
    }
    
    writeFileSync(jsonPath, JSON.stringify(RedisEnv));
    writeFileSync(envPath,
`REDIS_PASSWORD="${RedisEnv.password}"
REDIS_DISABLE_COMMANDS=FLUSHDB,FLUSHALL`
    );
}

async function generateKeyFile(filePath: string): Promise<void> {
    try {
      const key = randomBytes(756).toString('base64'); 
      writeFileSync(filePath, key); // Set permissions to 400 (read for owner only)
      console.log(`Key file generated successfully at ${filePath}`);
    } catch (error) {
      console.error('Error generating key file:', error);
      throw error; // Re-throw the error for proper handling in your script
    }
}

async function generateMongoEnvironment()
{
    const jsonPath = path.resolve(initOutputDir, 'mongo.json');
    const envPath = path.resolve(initOutputDir, 'mongo.env');
    const keyPath = path.resolve(initOutputDir, 'mongo.key');

    if (existsSync(jsonPath)) {
        MongoEnv = JSON.parse(readFileSync(jsonPath).toString());
    }

    if (!MongoEnv.username) {
        MongoEnv.username = 'root';
    }

    if (!MongoEnv.password) {
        MongoEnv.password = generateRandomPassword();
    }
    
    writeFileSync(jsonPath, JSON.stringify(MongoEnv));
    writeFileSync(envPath,
`MONGO_INITDB_ROOT_USERNAME="${MongoEnv.username}"
MONGO_INITDB_ROOT_PASSWORD="${MongoEnv.password}"`
    );

    await generateKeyFile(keyPath);
}

async function generatePostgresEnvironment()
{
    const jsonPath = path.resolve(initOutputDir, 'postgres.json');
    const envPath = path.resolve(initOutputDir, 'postgres.env');

    if (existsSync(jsonPath)) {
        PostgresEnv = JSON.parse(readFileSync(jsonPath).toString());
    }

    if (!PostgresEnv.username) {
        PostgresEnv.username = 'postgres';
    }

    if (!PostgresEnv.password) {
        PostgresEnv.password = generateRandomPassword();
    }
    
    writeFileSync(jsonPath, JSON.stringify(PostgresEnv));
    writeFileSync(envPath,
`POSTGRES_USER="${PostgresEnv.username}"
POSTGRES_PASSWORD="${PostgresEnv.password}"`
    );
}

async function generateZitadelEnvironment()
{
    const jsonPath = path.resolve(initOutputDir, 'zitadel.json');
    const envPath = path.resolve(initOutputDir, 'zitadel.env');

    if (existsSync(jsonPath)) {
        ZitadelEnv = JSON.parse(readFileSync(jsonPath).toString());
    }

    ZitadelEnv.postgres ??= {};

    if (!ZitadelEnv.masterKey) {
        ZitadelEnv.masterKey = generateRandomPassword();
    }

    if (!ZitadelEnv.postgres.username) {
        ZitadelEnv.postgres.username = 'zitadel';
    }

    if (!ZitadelEnv.postgres.password) {
        ZitadelEnv.postgres.password = generateRandomPassword();
    }
    
    writeFileSync(jsonPath, JSON.stringify(ZitadelEnv));
    writeFileSync(envPath,
`ZITADEL_MASTERKEY="${ZitadelEnv.masterKey}"
ZITADEL_DATABASE_POSTGRES_HOST="nextmu-postgres"
ZITADEL_DATABASE_POSTGRES_PORT=5432
ZITADEL_DATABASE_POSTGRES_DATABASE="zitadel"
ZITADEL_DATABASE_POSTGRES_USER_USERNAME="${ZitadelEnv.postgres.username}"
ZITADEL_DATABASE_POSTGRES_USER_PASSWORD="${ZitadelEnv.postgres.password}"
ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE="disable"
ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME="${PostgresEnv.username}"
ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD="${PostgresEnv.password}"
ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE="disable"
ZITADEL_EXTERNALSECURE="false"
ZITADEL_FIRSTINSTANCE_MACHINEKEYPATH="/machinekey/zitadel-admin-sa.json"
ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME="zitadel-admin-sa"
ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME="Admin"
ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINEKEY_TYPE=1`
    );
}

async function runInitScript()
{
    try { mkdirSync(initOutputDir); } catch(e) {}
    await generateRedisEnvironment();
    await generateMongoEnvironment();
    await generatePostgresEnvironment();
    await generateZitadelEnvironment();
}

const maxAttempts = 30;
let attempts = 0;

async function run(): Promise<void>
{
    if (++attempts > maxAttempts) return;
    
    if (process.env.RUN_MODE === 'init') {
        console.log(`Started Init script`);
        await runInitScript();
        console.log(`Finished, check environments folder.`);
    } else if (process.env.RUN_MODE === 'zitadel') {
        console.log(`Checking Zitadel if available (${attempts}/${maxAttempts} attempts)`);
        try {
            const response = await axios.get(resolve(api, '/debug/healthz'), { timeout: 5000 });
            if (response.data !== 'ok') {
                setTimeout(() => run(), 10000);
                return;
            }
    
            console.log(`Started Zitadel script`);
            try {
                await runZitadelScript();
            } catch(e) {
                console.log(`[ERROR] Zitadel script failed : ${e}`);
                throw e;
            }
            console.log(`Finished, check script-output folder.`);
        } catch(e) {
            setTimeout(() => run(), 10000);
        }
    }
}

run();