import { createAppAuth } from "@octokit/auth-app";
import { request as octokitRequest } from "@octokit/request";

export interface AppTokenRequest {
  appId: string;
  privateKey: string;
  owner: string;
  repo: string;
  apiUrl: string;
  serverUrl: string;
  fetch?: typeof fetch;
}

export interface AppTokenResult {
  token: string;
  login: string;
  email: string;
}

interface InstallationResponse {
  id: number;
  app_slug?: string;
}

interface UserResponse {
  id: number;
}

export async function createAppToken(
  options: AppTokenRequest
): Promise<AppTokenResult> {
  const request = octokitRequest.defaults({
    baseUrl: options.apiUrl,
    ...(options.fetch ? { request: { fetch: options.fetch } } : {}),
  });
  const auth = createAppAuth({
    appId: options.appId,
    privateKey: options.privateKey,
    request,
  });
  const appAuthentication = await auth({ type: "app" });
  const installation = (await request(
    "GET /repos/{owner}/{repo}/installation",
    {
      owner: options.owner,
      repo: options.repo,
      headers: {
        authorization: `Bearer ${appAuthentication.token}`,
      },
    }
  )) as { data: InstallationResponse };
  const installationAuthentication = await auth({
    type: "installation",
    installationId: installation.data.id,
  });
  const login = `${installation.data.app_slug ?? "github-app"}[bot]`;
  const user = (await request("GET /users/{username}", {
    username: login,
    headers: {
      authorization: `Bearer ${installationAuthentication.token}`,
    },
  })) as { data: UserResponse };

  return {
    token: installationAuthentication.token,
    login,
    email: githubNoReplyEmail(user.data.id, login, options.serverUrl),
  };
}

export function githubNoReplyEmail(
  id: number,
  login: string,
  serverUrl: string
): string {
  return `${id}+${login}@${noReplyDomain(serverUrl)}`;
}

function noReplyDomain(serverUrl: string): string {
  const host = new URL(serverUrl).host;
  return host === "github.com" ? "users.noreply.github.com" : `users.noreply.${host}`;
}
