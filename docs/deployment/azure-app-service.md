# Deploy to Azure App Service (Windows code deployment)

FSCM Traceability is an ASP.NET Core .NET 10 app. Its UI in `wwwroot` and API
are published together as one ZIP package; no container or separate frontend
deployment is required.

## Azure Web App

Create a Windows Web App with Publish set to **Code**, Runtime Stack set to
**.NET 10 (LTS)**, and the same region as FSCM. The Free F1 plan is suitable
only for demonstration or testing. Use the app's default HTTPS hostname or a
custom domain to access both the UI (`/`) and API (`/api/...`).

## Required App Service settings

Set these in **Environment variables > App settings**, never in repository
files or pipeline YAML:

| Setting | Required value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ConnectionStrings__TraceabilityConnection` | PostgreSQL connection for `fscm_traceability` |
| `Fscm__BaseUrl` | Public HTTPS FSCM API origin, ending in `/` |
| `Integration__ApiKey` | Random shared service key of at least 32 characters |
| `DataProtection__KeyPath` | `D:\home\site\keys` |

The integration key must equal `Traceability__ApiKey` in FSCM Backend. The
Data Protection folder persists encrypted authentication-cookie keys across
application restarts and package deployments.

## Azure DevOps pipeline

The manual pipeline in `azure-pipelines.yml` restores, builds, tests, publishes
`FSCM.Traceability.csproj`, zips only the publish output, and deploys it through
the `AzureWebApp@1` task. Create an Azure Resource Manager service connection
that can deploy to the Web App, then add only these non-secret pipeline
variables:

| Variable | Meaning |
|---|---|
| `azureSubscription` | Azure Resource Manager service connection name |
| `appName` | Azure Web App name, for example `fscm-traceability` |

Enable **SCM Basic Auth Publishing Credentials** on the App Service if the
deployment task reports a publishing-credential or ZIP deploy authorization
error. Do not enable FTP.

## First database migration

After the first code deployment, use the App Service Kudu console in
`D:\home\site\wwwroot` to run:

```powershell
dotnet .\FSCM.Traceability.dll --migrate
```

The command applies only pending Entity Framework migrations then exits. Do not
run reset or drop commands against this database.

## Verification

After deployment and migration, verify:

```text
https://<app-domain>/health
https://<app-domain>/health/ready
https://<app-domain>/
```

Then log in with an FSCM Admin account and confirm products and warehouses load
from the configured FSCM API.
