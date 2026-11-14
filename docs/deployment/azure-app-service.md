# Deploy to Azure App Service (Linux custom container)

FSCM Traceability is an ASP.NET application with a PostgreSQL database and
Data Protection keys. Deploy it as a Linux custom container, not as a static
site. The application and the FSCM API must both be reachable over HTTPS.

## One-time Azure setup

1. Create a Linux App Service plan and a Web App configured for Docker.
2. Create or select an Azure Container Registry (ACR). Grant the Web App's
   managed identity `AcrPull` on the registry; do not store registry passwords
   in Web App settings when managed identity is available.
   Create a GitHub Actions federated identity with ACR `AcrPush` and the Web
   App deployment permissions required by your subscription.
3. Enable App Service storage with `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true`.
   It persists `/home`; configure `DataProtection__KeyPath=/home/keys`.
4. Configure the App Service Health check path as `/health/ready` and HTTPS
   only. Set the container port with `WEBSITES_PORT=8080`.
5. Provision a dedicated PostgreSQL database named `fscm_traceability` and a
   least-privileged application user. It must be network-reachable from the
   Web App. Do not reuse FSCM's warehouse database or credentials.

## Required App Service settings

Set these as App Service application settings (not files in the image and not
repository secrets):

| Setting | Required value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `WEBSITES_PORT` | `8080` |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` |
| `ConnectionStrings__TraceabilityConnection` | Production PostgreSQL connection for `fscm_traceability` |
| `Fscm__BaseUrl` | HTTPS origin of FSCM API, ending in `/` |
| `Integration__ApiKey` | Random shared service key of at least 32 characters |
| `DataProtection__KeyPath` | `/home/keys` |

The integration key must match the `Traceability__ApiKey` setting in the FSCM
backend. FSCM must also have the Traceability service origin and public UI URL
configured with trailing slashes. Keep all values in the platform secret store;
never add them to `appsettings.json`, `appsettings.Local.json`, GitHub source,
or client code.

## Migrate before first production start

Build the exact image to be deployed, then run it once with `--migrate` against
the production Traceability database through a controlled operator environment.
It exits after applying only pending Entity Framework migrations:

```text
dotnet FSCM.Traceability.dll --migrate
```

Use a one-off Azure Container Instance, Container Apps Job, or a secured
operator host that has the same network access and application settings. Do not
run destructive database reset commands. After a successful migration, deploy
the normal image to App Service.

## GitHub Actions deployment

The repository contains a manual workflow at
`.github/workflows/deploy-azure-app-service.yml`. Configure the following
before running it:

- Repository variables: `ACR_LOGIN_SERVER` and `AZURE_WEBAPP_NAME`.
- Repository variables: `ACR_NAME`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
  `AZURE_SUBSCRIPTION_ID` for the GitHub Actions federated identity.
- In the App Service, configure the ACR image pull and the application settings
  listed above.

The workflow builds the root `Dockerfile`, pushes
`fscm-traceability:<image_tag>` to ACR, and changes the App Service image. It
does not run migrations automatically; migration is intentionally a separate,
auditable release step.

## Azure DevOps pipeline

`azure-pipelines.yml` is the equivalent manual Azure DevOps pipeline. Import
the GitHub repository into Azure DevOps or create a pipeline that points at the
repository and that YAML file. In the pipeline Variables UI, create these
non-secret variables:

| Variable | Meaning |
|---|---|
| `azureSubscription` | Azure Resource Manager service connection name |
| `dockerRegistryServiceConnection` | Docker Registry service connection for ACR |
| `containerRegistry` | ACR login server, for example `name.azurecr.io` |
| `imageRepository` | `fscm-traceability` |
| `appName` | Linux App Service name |

Store only application secrets in an Azure DevOps variable group backed by
Azure Key Vault, then set the resulting values in App Service application
settings. Do not pass the database connection or integration key in YAML.

The pipeline has no automatic trigger and deploys only when you manually run
it. Its first stage restores, builds, and tests; its second stage builds a
uniquely tagged Docker image, pushes it to ACR, then uses
`AzureWebAppContainer@1` to change the App Service image.

## Verification and rollback

After deployment, verify `https://<traceability-domain>/health` and
`/health/ready`, then log in as an FSCM Admin and load product/warehouse
catalogs. Verify the FSCM-to-Traceability manifest/ACK flow using a non-live
pallet first. Roll back by selecting the previous immutable image tag in App
Service; do not roll database migrations backward unless an approved recovery
plan explicitly requires it.
