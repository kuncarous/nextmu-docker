import { createServiceAccountInterceptor, createManagementClient, ManagementServiceClient, createAdminClient, AdminServiceClient } from "@zitadel/node/api";
import { ServiceAccount } from "@zitadel/node/credentials";
import { Metadata } from "nice-grpc-common";
import { readFileSync, writeFileSync } from "node:fs";

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

// Script
const api = process.env.ZITADEL_URL || 'http://localhost:8080';
const audience = process.env.ZITADEL_AUDIENCE || 'http://localhost:8080';
const username = process.env.ZITADEL_ADMIN_USERNAME || 'admin';
const password = process.env.ZITADEL_ADMIN_PASSWORD || 'Admin1!@#';

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

async function createOrFindProject(managementClient: ManagementServiceClient, metadata: Metadata)
{
    const listResponse = await managementClient.listProjects({}, { metadata });
    const project = listResponse.result.find(proj => proj.name === 'NextMU');
    if (project != null) return project.id;
    const response = await managementClient.addProject({ name: 'NextMU' }, { metadata });
    return response.id;
}

async function createOrFindWebApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({}, { metadata });
    const app = listResponse.result.find(proj => proj.name === 'Web');
    if (app != null) return {
        appId: app.id,
        clientId: app.oidcConfig!.clientId,
    };
    const response = await managementClient.addOIDCApp(
        {
            projectId,
            name: 'Web',
            redirectUris: ['http://localhost:5173/auth/callback'],
            responseTypes: [OIDCResponseType.OIDC_RESPONSE_TYPE_CODE],
            grantTypes: [OIDCGrantType.OIDC_GRANT_TYPE_AUTHORIZATION_CODE, OIDCGrantType.OIDC_GRANT_TYPE_REFRESH_TOKEN],
            appType: OIDCAppType.OIDC_APP_TYPE_WEB,
            authMethodType: OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_NONE,
            postLogoutRedirectUris: ['http://localhost:5173/logout/callback'],
            version: OIDCVersion.OIDC_VERSION_1_0,
            devMode: true,
            accessTokenType: OIDCTokenType.OIDC_TOKEN_TYPE_BEARER,
            accessTokenRoleAssertion: false,
            idTokenRoleAssertion: true,
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

async function createOrFindGameApplication(managementClient: ManagementServiceClient, projectId: string, metadata: Metadata)
{
    const listResponse = await managementClient.listApps({}, { metadata });
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
            accessTokenRoleAssertion: false,
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

async function start()
{
    const serviceAccount = createServiceAccount();
    const serviceInterceptor = createServiceAccountInterceptor(audience, serviceAccount, { apiAccess: true });
    
    const managementClient = createManagementClient(api, serviceInterceptor);
    const adminClient = createAdminClient(api, serviceInterceptor);

    const userId = await createOrFindAdminUser(managementClient, adminClient);
    const organizationId = await createOrFindOrganization(managementClient, adminClient);
    
    const metadata = new Metadata();
    metadata.append('x-zitadel-orgid', organizationId);
    const projectId = await createOrFindProject(managementClient, metadata);
    const webApp = await createOrFindWebApplication(managementClient, projectId, metadata);
    const gameApp = await createOrFindGameApplication(managementClient, projectId, metadata);

    writeFileSync(
        '../zitadel-output/config.json',
        JSON.stringify(
            {
                admin: {
                    username,
                    password,
                },
                web: webApp,
                game: gameApp,
            }
        )
    );
}

// Delay it 10s
setTimeout(start, 10000);